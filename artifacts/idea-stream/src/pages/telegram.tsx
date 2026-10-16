import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, ExternalLink, FileText, Hash, Image as ImageIcon, Link2, Loader2, Mic, Send, Unlink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { LiveError, liveFetch } from "@/lib/live-api";
import { QrCode } from "@/pages/live-sessions";

type Status = { connected: boolean; botUsername: string | null; linked: boolean; chatName: string; pairLink: string | null };

/**
 * Capture from Telegram: make your own bot (two minutes with BotFather), paste its token here,
 * then pair your chat. After that, whatever you send the bot lands in your Idea inbox.
 */
export default function TelegramPage() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void liveFetch<Status>("/api/telegram").then(setStatus).catch(() => setStatus(null)); }, []);
  // Waiting for "Start" in Telegram.
  useEffect(() => {
    if (!status?.connected || status.linked) return;
    const timer = window.setInterval(() => { void liveFetch<Status>("/api/telegram").then(setStatus).catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, [status?.connected, status?.linked]);

  const act = async (work: () => Promise<Status>) => {
    setBusy(true);
    try { setStatus(await work()); }
    catch (error) { toast({ variant: "destructive", title: error instanceof LiveError ? error.message : copy("It didn't work. Try again.", "لم ينجح. حاول مجددًا.") }); }
    finally { setBusy(false); }
  };
  const step = (n: number, done: boolean, title: string, children: React.ReactNode) => (
    <li className={`rounded-3xl border bg-card p-5 shadow-sm ${done ? "opacity-70" : ""}`}>
      <p className="flex items-center gap-3 font-semibold">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? "bg-emerald-600 text-white" : "bg-sky-600 text-white"}`}>{done ? <Check size={16} /> : n}</span>{title}
      </p>
      <div className="mt-3 ps-11 text-sm leading-6">{children}</div>
    </li>
  );
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2 sm:px-6">
      <div className="mb-6 flex items-start gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#229ED9] text-white shadow-md"><Send size={26} className="-ms-0.5 rtl:-scale-x-100" /></span>
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{copy("Capture from Telegram", "الالتقاط من تيليجرام")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy("Send ideas to your own private bot, from anywhere, and they appear in your Idea inbox, written out and filed.", "أرسل أفكارك إلى بوتك الخاص من أي مكان، فتظهر في صندوق الأفكار مكتوبة ومرتّبة.")}</p>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[[Mic, copy("Voice notes, written out", "رسائل صوتية تُكتب")], [ImageIcon, copy("Photos and videos", "صور وفيديو")], [Link2, copy("Links and text", "روابط ونصوص")], [FileText, copy("PDFs and files", "ملفات PDF")]].map(([Icon, label], i) => {
          const I = Icon as typeof Mic;
          return <span key={i} className="flex items-center gap-2 rounded-2xl bg-secondary/60 px-3 py-2 text-xs font-medium"><I size={15} className="shrink-0 text-[#229ED9]" />{label as string}</span>;
        })}
      </div>

      {!status ? (
        <div className="grid h-32 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : status.linked ? (
        <div className="space-y-4">
          <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950/30">
            <p className="text-4xl">✅</p>
            <p className="mt-2 font-serif text-2xl">{copy("Telegram is connected", "تيليجرام متصل")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy(`@${status.botUsername} saves what ${status.chatName || "you"} send${status.chatName ? "s" : ""} into your Idea inbox.`, `@${status.botUsername} يحفظ ما يرسله ${status.chatName || "أنت"} في صندوق الأفكار.`)}</p>
            <a href={`https://t.me/${status.botUsername}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white"><Send size={15} className="rtl:-scale-x-100" />{copy("Open the bot", "افتح البوت")}</a>
          </div>
          <div className="rounded-3xl border bg-card p-5 text-sm leading-6">
            <p className="mb-2 flex items-center gap-1.5 font-semibold"><Hash size={16} className="text-[#229ED9]" />{copy("Tips", "نصائح")}</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>{copy("Start a message with #NotebookName to file it there, e.g. “#Physics read chapter 3”. The start of the name is enough.", "ابدأ الرسالة بـ #اسم_الدفتر لحفظها فيه، مثل «#الفيزياء اقرأ الفصل 3». تكفي بداية الاسم.")}</li>
              <li>{copy("Send /notebooks to see your notebooks' tags.", "أرسل /notebooks لترى وسوم دفاترك.")}</li>
              <li>{copy("Voice notes are written out and also added to your audio library.", "الرسائل الصوتية تُكتب وتُضاف أيضًا إلى مكتبة الصوت.")}</li>
              <li>{copy("Forward messages, articles or voice notes from other chats too.", "يمكنك أيضًا إعادة توجيه رسائل ومقالات ورسائل صوتية من محادثات أخرى.")}</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => { if (window.confirm(copy("Pair a different Telegram chat? This one will stop saving.", "ربط محادثة أخرى؟ ستتوقف هذه عن الحفظ."))) void act(() => liveFetch<Status>("/api/telegram/unlink", { method: "POST", json: {} })); }}><Unlink size={15} className="me-1.5" />{copy("Pair another chat", "اربط محادثة أخرى")}</Button>
            <Button variant="ghost" className="rounded-full text-destructive" disabled={busy} onClick={() => { if (window.confirm(copy("Disconnect the bot?", "فصل البوت؟"))) void act(() => liveFetch<Status>("/api/telegram", { method: "DELETE" })); }}><X size={15} className="me-1.5" />{copy("Disconnect", "افصل")}</Button>
          </div>
        </div>
      ) : (
        <ol className="space-y-3">
          {step(1, status.connected, copy("Make your bot (2 minutes)", "أنشئ بوتك (دقيقتان)"), (
            <>
              <ol className="list-decimal space-y-1 ps-5">
                <li>{copy("Open BotFather in Telegram and send /newbot", "افتح BotFather في تيليجرام وأرسل /newbot")}</li>
                <li>{copy("Give it a name, e.g. “My Idea Stream”", "أعطه اسمًا، مثل «أفكاري»")}</li>
                <li>{copy("Give it a username ending in “bot”, e.g. nasser_ideas_bot", "أعطه اسم مستخدم ينتهي بـ bot، مثل nasser_ideas_bot")}</li>
                <li>{copy("BotFather replies with a token (a long line with a colon). Copy it.", "سيرد BotFather برمز (سطر طويل فيه نقطتان). انسخه.")}</li>
              </ol>
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#229ED9] px-4 py-2 text-sm font-semibold text-white"><ExternalLink size={14} />{copy("Open BotFather", "افتح BotFather")}</a>
            </>
          ))}
          {step(2, status.connected, copy("Paste the token here", "الصق الرمز هنا"), status.connected ? (
            <p>{copy(`Connected to @${status.botUsername}.`, `متصل بـ @${status.botUsername}.`)}</p>
          ) : (
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void act(() => liveFetch<Status>("/api/telegram/connect", { method: "POST", json: { token: token.trim() } })); }}>
              <Input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456789:AA…" aria-label={copy("Bot token", "رمز البوت")} dir="ltr" className="font-mono" />
              <Button type="submit" disabled={busy || !token.trim()} className="shrink-0 rounded-full">{busy ? <Loader2 size={15} className="me-1.5 animate-spin" /> : null}{copy("Connect", "اتصل")}</Button>
            </form>
          ))}
          {step(3, status.linked, copy("Pair your Telegram chat", "اربط محادثتك"), status.pairLink ? (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="w-36 shrink-0 overflow-hidden rounded-2xl border bg-white p-1"><QrCode text={status.pairLink} className="block w-full" /></div>
              <div>
                <p>{copy("Open the bot and tap Start. Only that chat will be able to save ideas. On a computer, scan the code with your phone.", "افتح البوت واضغط «ابدأ». هذه المحادثة وحدها تستطيع حفظ الأفكار. على الحاسوب امسح الرمز بهاتفك.")}</p>
                <a href={status.pairLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#229ED9] px-4 py-2 text-sm font-semibold text-white"><Send size={14} className="rtl:-scale-x-100" />{copy("Open the bot and tap Start", "افتح البوت واضغط ابدأ")}</a>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" />{copy("Waiting for you to tap Start…", "بانتظار الضغط على «ابدأ»…")}</p>
              </div>
            </div>
          ) : <p className="text-muted-foreground">{copy("After connecting the bot.", "بعد ربط البوت.")}</p>)}
        </ol>
      )}
    </main>
  );
}
