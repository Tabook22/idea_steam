import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, Presentation, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { LiveError, liveFetch, qrPath, showCode, type LiveSessionInfo, type LiveSessionSummary } from "@/lib/live-api";

/** A QR code people scan with their phone camera. */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => qrPath(text), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label={text}>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#0f172a" />
    </svg>
  );
}

/** Workshops: your sessions, and a new one (a name and the challenge everyone works on). */
export default function LiveSessionsPage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [sessions, setSessions] = useState<LiveSessionSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void liveFetch<LiveSessionSummary[]>("/api/live-admin/sessions").then(setSessions).catch(() => setSessions([])); }, []);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const session = await liveFetch<LiveSessionInfo>("/api/live-admin/sessions", { method: "POST", json: { title: title.trim(), challenge: challenge.trim() } });
      navigate(`/live/${session.id}`);
    } catch (error) { toast({ variant: "destructive", title: error instanceof LiveError ? error.message : copy("It couldn't be created.", "تعذر الإنشاء.") }); }
    finally { setBusy(false); }
  }
  const statusLabel = (status: string) => (status === "open" ? copy("Open", "مفتوحة") : status === "closed" ? copy("Joining closed", "الانضمام مغلق") : copy("Ended", "منتهية"));
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-2 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{copy("Workshops", "ورش العمل")}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{copy("Give a room one challenge. People join from their phones with a code or QR, just their name, no accounts, and work alone, in teams and together.", "امنح القاعة تحديًا واحدًا. ينضم الناس من هواتفهم برمز أو QR وبأسمائهم فقط دون حسابات، ويعملون فرادى وفي فرق ومعًا.")}</p>
        </div>
        <Button className="rounded-full" onClick={() => setCreating(true)}><Plus size={16} className="me-1.5" />{copy("New session", "جلسة جديدة")}</Button>
      </div>
      {!sessions ? (
        <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : !sessions.length ? (
        <div className="mx-auto mt-6 max-w-md rounded-3xl border border-dashed p-8 text-center">
          <p className="text-4xl">🎤</p>
          <p className="mt-3 font-serif text-2xl">{copy("Your first workshop", "ورشتك الأولى")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{copy("Create a session, put the QR code on the projector, and watch the ideas arrive.", "أنشئ جلسة، واعرض رمز QR على الشاشة، وشاهد الأفكار تصل.")}</p>
          <Button className="mt-5 rounded-full" onClick={() => setCreating(true)}><Plus size={16} className="me-1.5" />{copy("New session", "جلسة جديدة")}</Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sessions.map((session) => (
            <Link key={session.id} href={`/live/${session.id}`} className="group rounded-3xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <p dir="auto" className="font-serif text-xl leading-snug group-hover:text-primary">{session.title}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${session.status === "open" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-secondary text-muted-foreground"}`}>{statusLabel(session.status)}</span>
              </div>
              {session.challenge && <p dir="auto" className="mt-1 line-clamp-2 text-sm text-muted-foreground">{session.challenge}</p>}
              <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="font-mono font-bold tracking-wider text-foreground" dir="ltr">{showCode(session.code)}</span>
                <span className="inline-flex items-center gap-1"><Users size={13} />{session.participantCount}</span>
                <span className="inline-flex items-center gap-1"><Presentation size={13} />{copy(`${session.cardCount} ideas`, `${session.cardCount} فكرة`)}</span>
                <span>{new Date(session.createdAt).toLocaleDateString(language, { day: "numeric", month: "short" })}</span>
              </p>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">{copy("New session", "جلسة جديدة")}</DialogTitle>
            <DialogDescription>{copy("You'll get a code and a QR for people to join.", "ستحصل على رمز وQR لينضم الناس.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-medium">{copy("Name", "الاسم")}
              <Input autoFocus dir="auto" className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={copy("e.g. Design thinking: week 3", "مثلًا: التفكير التصميمي – الأسبوع 3")} />
            </label>
            <label className="block text-sm font-medium">{copy("The challenge everyone works on", "التحدي الذي يعمل عليه الجميع")}
              <textarea dir="auto" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6" rows={4} value={challenge} onChange={(event) => setChallenge(event.target.value)} maxLength={4000}
                placeholder={copy("e.g. How might we help first-year students feel at home in the first week?", "مثلًا: كيف نساعد طلاب السنة الأولى على الشعور بالانتماء في الأسبوع الأول؟")} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>{copy("Cancel", "إلغاء")}</Button>
            <Button onClick={() => void create()} disabled={!title.trim() || busy}>{busy && <Loader2 size={15} className="me-1.5 animate-spin" />}{copy("Create", "أنشئ")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
