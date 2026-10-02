import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type Request, type RequestHandler, type Response } from "express";
import { loginPage, type LoginError } from "./login-page";

const COOKIE = "idea_stream_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
// Fonts, icons, and the app manifest contain nothing private. The login page needs them,
// and Android fetches the manifest and icons without cookies when installing the app.
const PUBLIC_ASSET = /^\/(?:assets\/[\w.-]+\.woff2|favicon\.svg|apple-touch-icon\.png|icon-[\w-]+\.png|manifest\.webmanifest)$/;

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
  const base = (env.APP_BASE_PATH || "").replace(/\/$/, "");
  // Derived from the password hash, so changing the password signs out every device.
  const sessionKey = createHash("sha256").update(`idea-stream-session:${stored}`).digest();
  const sign = (expires: number) =>
    createHmac("sha256", sessionKey).update(`${user}.${expires}`).digest();
  const failures = new Map<string, { count: number; expires: number }>();
  const parseForm = express.urlencoded({ extended: false, limit: "4kb" });

  const credentialsMatch = (name: string, password: string) =>
    name === user &&
    password.length <= 1024 &&
    timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(digest, "hex"));
  const throttled = (ip: string) => {
    const previous = failures.get(ip);
    return !!previous && previous.expires > Date.now() && previous.count >= 20;
  };
  const recordFailure = (ip: string) => {
    const previous = failures.get(ip);
    failures.set(ip, {
      count: previous && previous.expires > Date.now() ? previous.count + 1 : 1,
      expires: Date.now() + 60_000,
    });
    if (failures.size > 1000)
      for (const [key, value] of failures)
        if (value.expires < Date.now()) failures.delete(key);
  };
  const sessionExpiry = (req: Request) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const [expiresText, signature] = raw?.split(".") || [];
    const expires = Number(expiresText);
    if (!Number.isSafeInteger(expires) || expires < Date.now() || !/^[a-f0-9]{64}$/.test(signature || ""))
      return null;
    return timingSafeEqual(sign(expires), Buffer.from(signature, "hex")) ? expires : null;
  };
  const setSession = (req: Request, res: Response, expires: number | null) => {
    const value = expires === null ? "" : `${expires}.${sign(expires).toString("hex")}`;
    res.append("Set-Cookie", [
      `${COOKIE}=${value}`,
      `Path=${base || "/"}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(req.secure ? ["Secure"] : []),
      expires === null ? "Max-Age=0" : `Max-Age=${Math.floor((expires - Date.now()) / 1000)}`,
    ].join("; "));
  };
  // Only same-app relative paths, never another origin.
  const safeNext = (value: unknown) =>
    typeof value === "string" && /^\/(?![/\\])[^\s\\]*$/.test(value) && !value.startsWith("/login")
      ? value
      : "/";
  const showLogin = (res: Response, status: number, next: string, error?: LoginError, username?: string) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.status(status).type("html").send(loginPage({ base, next, error, username }));
  };

  return (req, res, next) => {
    const origin = req.headers.origin;
    // Same-site requests are always safe, so www and bare-domain visits both work.
    // Some mobile browsers send "null" for a plain form post; the sign-in form still needs the password.
    const allowedOrigin =
      !origin ||
      origin === env.APP_ORIGIN ||
      origin === `${req.protocol}://${req.get("host")}` ||
      (origin === "null" && req.path === "/login");
    if (env.APP_ORIGIN && !allowedOrigin && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.path === "/login" || req.path === "/logout") {
        res.redirect(303, `${base}/login`);
        return;
      }
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (!user || !stored) {
      next();
      return;
    }
    const ip = req.ip || "unknown";

    if (req.path === "/login" && req.method === "POST") {
      parseForm(req, res, () => {
        const form = (req.body || {}) as Record<string, unknown>;
        const destination = safeNext(form.next);
        const name = typeof form.username === "string" ? form.username.trim().slice(0, 200) : "";
        if (throttled(ip)) {
          res.setHeader("Retry-After", "60");
          showLogin(res, 429, destination, "throttled", name);
          return;
        }
        const password = typeof form.password === "string" ? form.password : "";
        if (credentialsMatch(name, password)) {
          failures.delete(ip);
          setSession(req, res, Date.now() + SESSION_MS);
          res.redirect(303, `${base}${destination}`);
          return;
        }
        recordFailure(ip);
        showLogin(res, 401, destination, "invalid", name);
      });
      return;
    }
    if (req.path === "/logout" && req.method === "POST") {
      setSession(req, res, null);
      res.redirect(303, `${base}/login?signed-out=1`);
      return;
    }

    const session = sessionExpiry(req);
    if (session) {
      // Sliding renewal: an active device stays signed in.
      if (session - Date.now() < SESSION_MS / 2) setSession(req, res, Date.now() + SESSION_MS);
      if (req.path === "/login") {
        res.redirect(303, `${base}${safeNext(req.query.next)}`);
        return;
      }
      next();
      return;
    }

    // Scripts such as the VPS health check still use HTTP Basic credentials.
    const auth = req.headers.authorization;
    if (auth?.startsWith("Basic ") && auth.length < 4096) {
      if (throttled(ip)) {
        res.setHeader("Retry-After", "60");
        res.status(429).send("Too many sign-in attempts. Try again shortly.");
        return;
      }
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0 && credentialsMatch(decoded.slice(0, separator), decoded.slice(separator + 1))) {
        failures.delete(ip);
        next();
        return;
      }
      recordFailure(ip);
    }

    if (req.method === "GET" && PUBLIC_ASSET.test(req.path)) {
      next();
      return;
    }
    if (req.path === "/login" && (req.method === "GET" || req.method === "HEAD")) {
      showLogin(res, 200, safeNext(req.query.next), req.query["signed-out"] ? "signed-out" : undefined);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    const isPage =
      (req.method === "GET" || req.method === "HEAD") &&
      !req.path.startsWith("/api/") &&
      (req.headers["sec-fetch-mode"] === "navigate" || !!req.accepts("html") && req.accepts(["json", "html"]) === "html");
    if (isPage) {
      res.redirect(303, `${base}/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
      return;
    }
    // Browsers always send Sec-Fetch-Dest; leaving out the challenge for them avoids the native password dialog.
    if (!req.headers["sec-fetch-dest"])
      res.setHeader("WWW-Authenticate", 'Basic realm="Idea Stream", charset="UTF-8"');
    res.status(401).json({ error: "Sign in required", login: `${base}/login` });
  };
}
