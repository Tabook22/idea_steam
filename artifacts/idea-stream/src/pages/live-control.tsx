import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, Check, Copy as CopyIcon, FileDown, Loader2, Megaphone, MonitorPlay, Activity, MoreHorizontal, Shuffle, Target, Trash2, UserMinus, Users } from "lucide-react";
import { LiveIdeaCard } from "@/components/live-card";
import { StepsPanel, ThemesPanel } from "@/components/live-steps";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { LiveError, joinLink, liveFetch, showCode, teamColor, useLiveState, type LivePerson } from "@/lib/live-api";
import { QrCode } from "@/pages/live-sessions";

/**
 * The instructor's control room for one session: the join code and QR, the challenge, who joined,
 * teams (made in one tap, people moved by hand), and the walls of ideas, with hide and comment.
 */
export default function LiveControlPage() {
  const { id } = useParams<{ id: string }>();
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { state, error, refresh } = useLiveState(`/api/live-admin/sessions/${id}/state`, 2500);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [wall, setWall] = useState<"all" | number>("all");
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState(4);
  const [reporting, setReporting] = useState(false);
  async function report() {
    setReporting(true);
    try {
      const response = await fetch(appPath(`/api/live-admin/sessions/${id}/report`, import.meta.env.BASE_URL), { credentials: "same-origin" });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "report");
      const url = URL.createObjectURL(await response.blob());
      const name = decodeURIComponent(response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "workshop report.pdf");
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) { toast({ variant: "destructive", title: (error as Error).message !== "report" ? (error as Error).message : copy("The report couldn't be made.", "تعذر إنشاء التقرير.") }); }
    finally { setReporting(false); }
  }
  useEffect(() => { if (state && challenge === null) setChallenge(state.session.challenge); }, [state, challenge]);

  const act = async (work: () => Promise<unknown>, failed = copy("It didn't work. Try again.", "لم ينجح. حاول مجددًا.")) => {
    try { await work(); await refresh(); return true; }
    catch (failure) { toast({ variant: "destructive", title: failure instanceof LiveError ? failure.message : failed }); return false; }
  };
  const call = (path: string, method: string, json?: unknown) => liveFetch(`/api/live-admin${path}`, { method, ...(json !== undefined ? { json } : {}) });

  const people = state?.people ?? [];
  const teams = useMemo(() => Array.from({ length: state?.session.teamCount ?? 0 }, (_, index) => index + 1), [state?.session.teamCount]);
  const cards = (state?.cards ?? []).filter((card) => (wall === "all" ? card.space === "all" : card.space === "team" && card.team === wall)).sort((a, b) => b.id - a.id);
  const byId = useMemo(() => new Map((state?.cards ?? []).map((card) => [card.id, card])), [state?.cards]);

  if (!state) return (
    <main className="grid min-h-[50vh] place-items-center p-6 text-center text-muted-foreground">
      {error?.status === 404 ? <div><p>{copy("This session doesn't exist.", "هذه الجلسة غير موجودة.")}</p><Link href="/live" className="mt-2 inline-block text-primary underline">{copy("Back to Workshops", "العودة إلى ورش العمل")}</Link></div> : <Loader2 className="animate-spin" />}
    </main>
  );
  const session = state.session;
  const link = joinLink(session.code);
  const online = people.filter((person) => person.online).length;
  const ideas = state.cards.length;

  const personChip = (person: LivePerson) => (
    <DropdownMenu key={person.id}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-sm hover:border-primary/40">
          <span>{person.emoji}</span><span dir="auto" className="max-w-[9rem] truncate">{person.name}</span>
          {!!state.privateCounts?.[person.id] && <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground" title={copy("private ideas", "أفكار خاصة")}>{state.privateCounts[person.id]}</span>}
          <span className={`h-2 w-2 rounded-full ${person.online ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel dir="auto">{person.emoji} {person.name}</DropdownMenuLabel>
        {[...teams, teams.length + 1].filter((team) => team !== person.team).map((team) => (
          <DropdownMenuItem key={team} onSelect={() => void act(() => call(`/participants/${person.id}`, "PATCH", { team }))}>
            <span className="me-2 h-3 w-3 rounded-full" style={{ background: teamColor(team) }} />
            {team > teams.length ? copy(`Move to a new team (${team})`, `انقل إلى فريق جديد (${team})`) : copy(`Move to Team ${team}`, `انقل إلى الفريق ${team}`)}
          </DropdownMenuItem>
        ))}
        {person.team !== null && <DropdownMenuItem onSelect={() => void act(() => call(`/participants/${person.id}`, "PATCH", { team: null }))}>{copy("Take out of the team", "أخرجه من الفريق")}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { if (window.confirm(copy(`Remove ${person.name} and their ideas from the session?`, `إزالة ${person.name} وأفكاره من الجلسة؟`))) void act(() => call(`/participants/${person.id}`, "DELETE")); }}>
          <UserMinus size={15} className="me-2" />{copy("Remove from the session", "أزله من الجلسة")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const statuses: Array<[typeof session.status, string, string]> = [
    ["open", copy("Open", "مفتوحة"), copy("People can join", "يمكن الانضمام")],
    ["closed", copy("Closed", "مغلقة"), copy("No new people", "لا منضمين جدد")],
    ["ended", copy("Ended", "منتهية"), copy("Read only", "للقراءة فقط")],
  ];
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6">
      <Link href="/live" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} className="rtl:rotate-180" />{copy("Workshops", "ورش العمل")}</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 dir="auto" className="font-serif text-3xl leading-tight sm:text-4xl">{session.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy(`${people.length} joined · ${online} online · ${ideas} ideas`, `${people.length} انضموا · ${online} متصلون · ${ideas} فكرة`)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={appPath(`/live/${session.id}/present`, import.meta.env.BASE_URL)} target="_blank" rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"><MonitorPlay size={17} />{copy("Presenter screen", "شاشة العرض")}</a>
          <a href={appPath(`/live/${session.id}/pulse`, import.meta.env.BASE_URL)} target="_blank" rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90"><Activity size={17} />{copy("Workshop Pulse", "نبض الورشة")}</a>
          <Button variant="outline" className="rounded-full" disabled={reporting} onClick={() => void report()}>
            {reporting ? <Loader2 size={16} className="me-1.5 animate-spin" /> : <FileDown size={16} className="me-1.5" />}{copy("Report (PDF)", "التقرير (PDF)")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="rounded-full" aria-label={copy("More", "المزيد")}><MoreHorizontal size={17} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => {
                if (window.confirm(copy("Delete this session with everyone's ideas? This can't be undone.", "حذف هذه الجلسة مع أفكار الجميع؟ لا يمكن التراجع.")))
                  void act(async () => { await call(`/sessions/${session.id}`, "DELETE"); navigate("/live"); });
              }}><Trash2 size={15} className="me-2" />{copy("Delete the session", "احذف الجلسة")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="rounded-3xl border bg-card p-5 shadow-sm" aria-label={copy("Join", "الانضمام")}>
          <div className="mx-auto w-48 overflow-hidden rounded-2xl border bg-white p-1"><QrCode text={link} className="block w-full" /></div>
          <p className="mt-3 text-center font-mono text-4xl font-bold tracking-widest" dir="ltr">{showCode(session.code)}</p>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="mx-auto mt-2 flex max-w-full items-center gap-1.5 truncate rounded-full bg-secondary px-3 py-1 text-xs" dir="ltr">
            {copied ? <Check size={13} /> : <CopyIcon size={13} />}<span className="truncate">{link.replace(/^https?:\/\//, "")}</span>
          </button>
          <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-secondary p-1">
            {statuses.map(([value, label, hint]) => (
              <button key={value} type="button" title={hint} aria-pressed={session.status === value}
                onClick={() => { if (value !== "ended" || window.confirm(copy("End the session? Everyone can still read, but no one can add ideas.", "إنهاء الجلسة؟ يمكن للجميع القراءة دون إضافة أفكار."))) void act(() => call(`/sessions/${session.id}`, "PATCH", { status: value })); }}
                className={`rounded-xl px-2 py-2 text-xs font-semibold transition ${session.status === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-amber-300/70 bg-gradient-to-br from-amber-50 to-card p-5 shadow-sm dark:border-amber-800 dark:from-amber-950/20" aria-label={copy("The challenge", "التحدي")}>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200"><Target size={14} />{copy("The challenge", "التحدي")}</p>
          <textarea dir="auto" value={challenge ?? ""} onChange={(event) => setChallenge(event.target.value)} rows={4} maxLength={4000}
            placeholder={copy("The problem everyone works on…", "المشكلة التي يعمل عليها الجميع…")}
            className="w-full resize-y rounded-2xl border bg-background/80 px-3 py-2 text-base leading-7" />
          <div className="mt-2 flex justify-end">
            <Button size="sm" className="rounded-full" disabled={challenge === null || challenge === session.challenge}
              onClick={() => void act(async () => { await call(`/sessions/${session.id}`, "PATCH", { challenge }); toast({ title: copy("Everyone sees the new challenge.", "يرى الجميع التحدي الجديد.") }); })}>{copy("Save", "حفظ")}</Button>
          </div>
        </section>
      </div>

      <StepsPanel state={state} copy={copy} call={(path, method, json) => call(path, method, json)} act={act} />

      <section className="mt-6" aria-label={copy("People and teams", "المشاركون والفرق")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-serif text-2xl"><Users size={20} className="text-primary" />{copy("People and teams", "المشاركون والفرق")}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-muted-foreground">{copy("Teams of", "فرق من")}</span>
            {[2, 3, 4, 5, 6].map((value) => (
              <button key={value} type="button" onClick={() => setSize(value)} aria-pressed={size === value}
                className={`h-8 w-8 rounded-full border text-sm font-semibold ${size === value ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{value}</button>
            ))}
            <Button size="sm" className="rounded-full" disabled={people.length < 2}
              onClick={() => { if (!teams.length || window.confirm(copy("Make new teams? Everyone moves to a new team, with their team ideas.", "تكوين فرق جديدة؟ ينتقل الجميع إلى فرق جديدة مع أفكار فرقهم."))) void act(() => call(`/sessions/${session.id}/teams`, "POST", { size })); }}>
              <Shuffle size={15} className="me-1.5" />{teams.length ? copy("Shuffle teams", "أعد خلط الفرق") : copy("Make teams", "كوّن الفرق")}
            </Button>
            {teams.length > 0 && <Button size="sm" variant="ghost" className="rounded-full" onClick={() => { if (window.confirm(copy("Remove all teams?", "إلغاء كل الفرق؟"))) void act(() => call(`/sessions/${session.id}/teams`, "POST", { clear: true })); }}>{copy("No teams", "بلا فرق")}</Button>}
          </div>
        </div>
        {!people.length ? (
          <p className="rounded-3xl border border-dashed p-8 text-center text-sm text-muted-foreground">{copy("No one has joined yet. Show the QR code or the code on the screen.", "لم ينضم أحد بعد. اعرض رمز QR أو الرمز على الشاشة.")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => {
              const members = people.filter((person) => person.team === team);
              const teamCards = state.cards.filter((card) => card.space === "team" && card.team === team);
              const count = teamCards.length;
              // A team with nothing new for a while, during a working step, may be stuck.
              const last = teamCards.reduce((latest, card) => Math.max(latest, Date.parse(card.createdAt)), 0);
              const quietMinutes = Math.floor((Date.parse(state.now) - (last || Date.parse(state.session.createdAt))) / 60_000);
              const quiet = ["share", "build"].includes(state.session.phase) && quietMinutes >= 4;
              return (
                <div key={team} className="rounded-3xl border bg-card p-4 shadow-sm" style={{ borderTop: `4px solid ${teamColor(team)}` }}>
                  <div className="mb-2 flex items-center justify-between">
                    <button type="button" onClick={() => setWall(team)} className="font-semibold hover:underline" style={{ color: teamColor(team) }}>{copy(`Team ${team}`, `الفريق ${team}`)}</button>
                    <span className="text-xs text-muted-foreground">{copy(`${members.length} people · ${count} ideas`, `${members.length} أشخاص · ${count} فكرة`)}</span>
                  </div>
                  {quiet && <p className="mb-2 rounded-xl bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{copy(`Quiet for ${quietMinutes} min: maybe go and help`, `هادئ منذ ${quietMinutes} د: ربما تحتاج مساعدتك`)}</p>}
                  <div className="flex flex-wrap gap-1.5">{members.map(personChip)}</div>
                </div>
              );
            })}
            {people.some((person) => person.team === null) && (
              <div className="rounded-3xl border border-dashed bg-card/60 p-4">
                <p className="mb-2 text-sm font-semibold text-muted-foreground">{teams.length ? copy("Not in a team", "بلا فريق") : copy(`Joined (${people.length})`, `انضموا (${people.length})`)}</p>
                <div className="flex flex-wrap gap-1.5">{people.filter((person) => person.team === null).map(personChip)}</div>
              </div>
            )}
          </div>
        )}
      </section>

      <ThemesPanel state={state} copy={copy} call={(path, method, json) => call(path, method, json)} act={act} />

      <section className="mt-8" aria-label={copy("Ideas", "الأفكار")}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="me-2 font-serif text-2xl">{copy("Ideas", "الأفكار")}</h2>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <button type="button" onClick={() => setWall("all")} aria-pressed={wall === "all"} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${wall === "all" ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
              {copy("Everyone", "الجميع")} <span className="ms-1 rounded-full bg-black/10 px-1.5 text-xs">{state.cards.filter((card) => card.space === "all").length}</span>
            </button>
            {teams.map((team) => (
              <button key={team} type="button" onClick={() => setWall(team)} aria-pressed={wall === team}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${wall === team ? "text-white" : "bg-card"}`} style={wall === team ? { background: teamColor(team), borderColor: teamColor(team) } : undefined}>
                {copy(`Team ${team}`, `الفريق ${team}`)} <span className="ms-1 rounded-full bg-black/10 px-1.5 text-xs">{state.cards.filter((card) => card.space === "team" && card.team === team).length}</span>
              </button>
            ))}
          </div>
        </div>
        {wall === "all" && (
          <form className="mb-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) void act(async () => { await call(`/sessions/${session.id}/cards`, "POST", { text: prompt.trim() }); setPrompt(""); }); }}>
            <input dir="auto" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} aria-label={copy("Post to everyone", "انشر للجميع")}
              placeholder={copy("Post a question or instruction to everyone…", "انشر سؤالًا أو تعليمات للجميع…")} className="h-11 min-w-0 flex-1 rounded-full border bg-card px-4 text-sm outline-none focus:border-primary" />
            <Button type="submit" className="h-11 rounded-full" disabled={!prompt.trim()}><Megaphone size={16} className="me-1.5" />{copy("Post", "انشر")}</Button>
          </form>
        )}
        {cards.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{copy("No ideas here yet.", "لا أفكار هنا بعد.")}</p>
        ) : (
          <div className="columns-1 gap-4 md:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {cards.map((card) => (
              <LiveIdeaCard key={card.id} card={card} parent={card.parentId ? byId.get(card.parentId) : undefined} copy={copy} instructor showTeam={wall === "all"}
                onComment={(text) => act(() => call(`/cards/${card.id}/comments`, "POST", { text }))}
                onHide={(hidden) => void act(() => call(`/cards/${card.id}`, "PATCH", { hidden }))}
                onDelete={() => { if (window.confirm(copy("Delete this idea?", "حذف هذه الفكرة؟"))) void act(() => call(`/cards/${card.id}`, "DELETE")); }} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
