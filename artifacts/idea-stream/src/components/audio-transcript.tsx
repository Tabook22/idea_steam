import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { appPath } from "@/lib/app-path";

/** Works from any device using the original audio already saved on the server. */
export function AudioTranscript({ ideaId, attachmentIndex, transcript }: {
  ideaId: number; attachmentIndex: number; transcript?: string;
}) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => isArabic ? ar : en;
  const [language, setLanguage] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const value = transcript || text;
  async function convert() {
    setBusy(true); setError("");
    try {
      const response = await fetch(appPath(`/api/ideas/${ideaId}/transcription`, import.meta.env.BASE_URL), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentIndex, language }), signal: AbortSignal.timeout(150_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || copy("Please retry transcription.", "حاول تفريغ التسجيل مجددًا."));
      setText(result.text);
      await queryClient.invalidateQueries();
    } catch (error) {
      setError(error instanceof Error ? error.message : copy("Transcription unavailable. Audio is saved.", "التفريغ غير متاح. الصوت محفوظ."));
    } finally { setBusy(false); }
  }
  return <div className="border-t p-3 space-y-3">
    <p className="text-sm font-medium">{copy("Recording transcript", "نص التسجيل")}</p>
    {value ? <>
      <p dir="auto" className="whitespace-pre-wrap text-sm leading-7 max-h-72 overflow-y-auto select-text">{value}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => setError(copy("Select the text to copy it.", "حدد النص لنسخه.")))}>{copied ? copy("Copied", "تم النسخ") : copy("Copy text", "نسخ النص")}</Button>
        <a className="p-2 text-xs underline" download="transcript.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(value)}`}>{copy("Download text", "تنزيل النص")}</a>
      </div>
    </> : <>
      <select aria-label={copy("Transcript language", "لغة التفريغ")} className="w-full rounded-lg border bg-background p-2 text-sm" value={language} disabled={busy} onChange={e => setLanguage(e.target.value)}>
        <option value="auto">{copy("Detect spoken language", "اكتشاف اللغة المنطوقة")}</option><option value="ar">العربية</option><option value="en">English</option>
      </select>
      <Button size="sm" disabled={busy} onClick={() => void convert()}>{busy ? copy("Converting to text…", "جارٍ التحويل إلى نص…") : copy("Convert to text", "تحويل إلى نص")}</Button>
    </>}
    {error && <p role="alert" className="text-xs text-amber-800">{error}</p>}
  </div>;
}
