/** Prefix app-owned API URLs without changing external links or already-prefixed URLs. */
export function appPath(url: string, base: string = "/") {
  const prefix = base.replace(/\/$/, "");
  return url.startsWith("/api/") ? `${prefix}${url}` : url;
}
