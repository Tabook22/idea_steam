const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

export type SharedItem = { url: string | null; title: string; text: string };

/** Android puts the link in "text" for many apps (YouTube, WhatsApp); find it wherever it is. */
export function parseShared(params: URLSearchParams): SharedItem {
  const rawTitle = (params.get("title") || "").trim();
  const rawText = (params.get("text") || "").trim();
  const candidate = (params.get("url") || "").trim() || rawText.match(URL_IN_TEXT)?.[0] || rawTitle.match(URL_IN_TEXT)?.[0] || "";
  let url: string | null = null;
  try {
    const parsed = new URL(candidate.replace(/[).,;!?]+$/, ""));
    if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.toString();
  } catch { /* Not a link; keep it as text. */ }
  const strip = (value: string) => (url ? value.replace(candidate, "") : value).replace(/\s+/g, " ").trim();
  const title = strip(rawTitle);
  const text = strip(rawText);
  return { url, title, text: text === title ? "" : text };
}
