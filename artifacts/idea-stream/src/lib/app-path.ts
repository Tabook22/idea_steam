/** Prefix app-owned API URLs without changing external links or already-prefixed URLs. */
export function appPath(url: string, base: string = "/") {
  const prefix = base.replace(/\/$/, "");
  return url.startsWith("/api/") ? `${prefix}${url}` : url;
}

export function uploadCredentials(url: string, origin?: string): RequestCredentials {
  if (url.startsWith("/") && !url.startsWith("//")) return "same-origin";
  return origin && new URL(url, origin).origin === origin ? "same-origin" : "omit";
}
