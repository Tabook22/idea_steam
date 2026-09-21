import { scryptSync, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** Optional single-owner gate for a private VPS. This is not multi-user account isolation. */
export function privateAccess(env = process.env): RequestHandler {
  const user = env.APP_USERNAME;
  const stored = env.APP_PASSWORD_HASH;
  if (env.APP_REQUIRE_AUTH === "true" && (!user || !stored))
    throw new Error(
      "Private deployment requires APP_USERNAME and APP_PASSWORD_HASH",
    );
  const [salt, digest] = stored?.split(":") || [];
  if (stored && (!salt || !/^[a-f0-9]{64}$/.test(digest)))
    throw new Error("Invalid APP_PASSWORD_HASH");
  const failures = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (
      env.APP_ORIGIN &&
      origin &&
      origin !== env.APP_ORIGIN &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (!user || !stored) {
      next();
      return;
    }
    const ip = req.ip || "unknown";
    const previous = failures.get(ip);
    if (previous && previous.expires > Date.now() && previous.count >= 20) {
      res.setHeader("Retry-After", "60");
      res.status(429).send("Too many sign-in attempts. Try again shortly.");
      return;
    }
    const auth = req.headers.authorization;
    if (auth?.startsWith("Basic ") && auth.length < 4096) {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      const candidate = scryptSync(decoded.slice(separator + 1), salt, 32);
      if (
        separator >= 0 &&
        decoded.slice(0, separator) === user &&
        timingSafeEqual(candidate, Buffer.from(digest, "hex"))
      ) {
        failures.delete(ip);
        next();
        return;
      }
      failures.set(ip, {
        count:
          previous && previous.expires > Date.now() ? previous.count + 1 : 1,
        expires: Date.now() + 60_000,
      });
      if (failures.size > 1000)
        for (const [key, value] of failures)
          if (value.expires < Date.now()) failures.delete(key);
    }
    res.setHeader(
      "WWW-Authenticate",
      'Basic realm="Idea Stream", charset="UTF-8"',
    );
    res.setHeader("Cache-Control", "no-store");
    res.status(401).send("Sign in to your private Idea Stream notebook.");
  };
}
