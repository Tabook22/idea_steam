import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Camera, LayoutDashboard, List, StickyNote, CircleHelp, CornerDownRight, Globe2, Loader2, Lock, Mic, Send, Square, Target, Users, X } from "lucide-react";
import { bestTab, participantNudge } from "@/lib/live-guide";
import { LiveIdeaCard } from "@/components/live-card";
import { LiveBoard } from "@/components/live-board";
import { NOTE_COLORS, type NoteColor } from "@/lib/live-board";
import { PhaseBanner } from "@/components/live-phase";
import { LanguageToggle } from "@/components/language-toggle";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { LIVE_EMOJIS, LiveError, liveFetch, shrinkPhoto, showCode, teamColor, useLiveState, type LiveCard, type LivePerson, type LiveSpace } from "@/lib/live-api";

type Copy = (en: string, ar: string) => string;
const NAME_KEY = "idea-live-name";
const EMOJI_KEY = "idea-live-emoji";
const remember = (key: string, value?: string) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* optional */ } return null; };

/**
 * The participant's side of a workshop, on its own (no owner data, no sign-in): enter the code
 * (or scan it), type your name, and you're in: three spaces, Me, My team and Everyone.
 */
export default function LiveJoinApp() {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const fromPath = () => decodeURIComponent(location.pathname.slice(base.length)).match(/^\/join\/?([\w-]*)/)?.[1]?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  const [code, setCode] = useState(fromPath);
  useEffect(() => {
    const back = () => setCode(fromPath());
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (next: string) => { history.pushState(null, "", appPath(`/join/${next}`, import.meta.env.BASE_URL)); setCode(next); };
  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.10),transparent_60%)] bg-background text-foreground">
      {code ? <Session code={code} copy={copy} onLeave={() => go("")} /> : <CodeEntry copy={copy} onCode={go} />}
      <Toaster />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-6 flex justify-end"><LanguageToggle /></div>
      {children}
    </main>
  );
}

function CodeEntry({ copy, onCode }: { copy: Copy; onCode: (code: string) => void }) {
  const [value, setValue] = useState("");
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (
    <Shell>
      <div className="text-center">
        <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-primary text-3xl text-primary-foreground shadow-lg">💡</span>
        <h1 className="font-serif text-4xl">{copy("Join the session", "انضم إلى الجلسة")}</h1>
        <p className="mt-2 text-muted-foreground">{copy("Type the code on the screen.", "اكتب الرمز الظاهر على الشاشة.")}</p>
      </div>
      <form className="mt-8 space-y-4" onSubmit={(event) => { event.preventDefault(); if (clean.length >= 6) onCode(clean); }}>
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false}
          placeholder="ABC-234" aria-label={copy("Session code", "رمز الجلسة")} dir="ltr"
          className="h-16 w-full rounded-2xl border-2 bg-card text-center font-mono text-3xl font-bold uppercase tracking-[0.3em] outline-none focus:border-primary" />
        <button type="submit" disabled={clean.length < 6} className="h-14 w-full rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-md transition active:scale-[0.99] disabled:opacity-40">{copy("Continue", "متابعة")}</button>
      </form>
    </Shell>
  );
}

type Info = { code: string; title: string; challenge: string; status: "open" | "closed" | "ended"; me: LivePerson | null };

function Session({ code, copy, onLeave }: { code: string; copy: Copy; onLeave: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setInfo(null); setError(null);
    liveFetch<Info>(`/api/live/${code}`)
      .then((found) => { if (!cancelled) { setInfo(found); setJoined(!!found.me); } })
      .catch((failure) => { if (!cancelled) setError(failure instanceof LiveError ? failure.message : copy("No connection. Try again.", "لا يوجد اتصال. حاول مجددًا.")); });
    return () => { cancelled = true; };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return (
    <Shell>
      <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
        <p className="text-4xl">🤔</p>
        <p className="mt-3 font-semibold">{error}</p>
        <button type="button" onClick={onLeave} className="mt-5 h-12 w-full rounded-2xl bg-primary font-semibold text-primary-foreground">{copy("Type the code again", "اكتب الرمز مجددًا")}</button>
      </div>
    </Shell>
  );
  if (!info) return <div className="grid min-h-[100dvh] place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (!joined) return <JoinForm info={info} copy={copy} onJoined={() => setJoined(true)} />;
  return <Room code={info.code} copy={copy} />;
}

function JoinForm({ info, copy, onJoined }: { info: Info; copy: Copy; onJoined: () => void }) {
  const [name, setName] = useState(() => remember(NAME_KEY) ?? "");
  const [emoji, setEmoji] = useState(() => remember(EMOJI_KEY) ?? LIVE_EMOJIS[Math.floor(Math.random() * LIVE_EMOJIS.length)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = info.status !== "open";
  async function join() {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      await liveFetch(`/api/live/${info.code}/join`, { method: "POST", json: { name: name.trim(), emoji } });
      remember(NAME_KEY, name.trim()); remember(EMOJI_KEY, emoji);
      onJoined();
    } catch (failure) { setError(failure instanceof LiveError ? failure.message : copy("No connection. Try again.", "لا يوجد اتصال. حاول مجددًا.")); }
    finally { setBusy(false); }
  }
  return (
    <Shell>
      <p className="text-center font-mono text-sm font-semibold tracking-widest text-muted-foreground" dir="ltr">{showCode(info.code)}</p>
      <h1 dir="auto" className="mt-1 text-center font-serif text-3xl leading-tight">{info.title}</h1>
      {info.challenge && (
        <div className="mt-5 rounded-3xl border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200"><Target size={14} />{copy("The challenge", "التحدي")}</p>
          <p dir="auto" className="line-clamp-4 whitespace-pre-wrap text-sm leading-6">{info.challenge}</p>
        </div>
      )}
      {closed ? (
        <p className="mt-6 rounded-2xl bg-secondary p-4 text-center text-sm">{info.status === "ended" ? copy("This session has ended.", "انتهت هذه الجلسة.") : copy("Joining is closed for now. Ask the instructor to open it.", "الانضمام مغلق الآن. اطلب من المدرّب فتحه.")}</p>
      ) : (
        <form className="mt-6 space-y-5" onSubmit={(event) => { event.preventDefault(); void join(); }}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">{copy("Your name", "اسمك")}</span>
            <input autoFocus dir="auto" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoComplete="given-name"
              placeholder={copy("e.g. Sara", "مثلًا: سارة")} className="h-14 w-full rounded-2xl border-2 bg-card px-4 text-lg outline-none focus:border-primary" />
          </label>
          <div>
            <span className="mb-2 block text-sm font-semibold">{copy("Pick your avatar", "اختر رمزك")}</span>
            <div className="grid grid-cols-8 gap-1.5">
              {LIVE_EMOJIS.map((one) => (
                <button key={one} type="button" onClick={() => setEmoji(one)} aria-pressed={emoji === one} aria-label={one}
                  className={`grid aspect-square place-items-center rounded-xl text-2xl transition ${emoji === one ? "scale-110 bg-primary/15 ring-2 ring-primary" : "bg-card hover:bg-secondary"}`}>{one}</button>
              ))}
            </div>
          </div>
          {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
          <button type="submit" disabled={!name.trim() || busy} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-md transition active:scale-[0.99] disabled:opacity-40">
            {busy ? <Loader2 className="animate-spin" /> : <span className="text-2xl">{emoji}</span>}{copy("Join", "انضم")}
          </button>
          <p className="text-center text-xs text-muted-foreground">{copy("No account needed. Only your name is shown to others.", "لا حاجة لحساب. يظهر اسمك فقط للآخرين.")}</p>
          <p className="text-center text-xs text-muted-foreground">{copy("What you share with your team or everyone may be shown on the big screen. Ideas in “Me” stay private.", "ما تشاركه مع فريقك أو الجميع قد يُعرض على الشاشة الكبيرة. أفكار «أنا» تبقى خاصة.")}</p>
        </form>
      )}
    </Shell>
  );
}

const TABS: Array<{ space: LiveSpace; icon: typeof Lock; en: string; ar: string; hintEn: string; hintAr: string }> = [
  { space: "me", icon: Lock, en: "Me", ar: "أنا", hintEn: "only you", hintAr: "لك وحدك" },
  { space: "team", icon: Users, en: "My team", ar: "فريقي", hintEn: "your team", hintAr: "لفريقك" },
  { space: "all", icon: Globe2, en: "Everyone", ar: "الجميع", hintEn: "all people", hintAr: "للجميع" },
];

function Room({ code, copy }: { code: string; copy: Copy }) {
  const { toast } = useToast();
  const { state, error, refresh } = useLiveState(`/api/live/${code}/state`, 3000);
  const [tab, setTab] = useState<LiveSpace>(() => (sessionStorage.getItem(`idea-live-tab-${code}`) as LiveSpace) || "me");
  const [buildOn, setBuildOn] = useState<LiveCard | null>(null);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const introKey = `idea-live-intro-${code}`;
  const [intro, setIntro] = useState(() => remember(introKey) !== "seen");
  const [help, setHelp] = useState(false);
  const [wallView, setWallView] = useState<"board" | "list">(() => (remember("idea-live-wall") as "board" | "list") || "board");
  const chooseView = (view: "board" | "list") => { remember("idea-live-wall", view); setWallView(view); };
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const closeIntro = () => { remember(introKey, "seen"); setIntro(false); };
  const [seen, setSeen] = useState<Record<LiveSpace, number>>({ me: 0, team: 0, all: 0 });
  useEffect(() => { try { sessionStorage.setItem(`idea-live-tab-${code}`, tab); } catch { /* optional */ } }, [code, tab]);
  // When the instructor moves the room to a new step, the screen goes where that step happens.
  const phase = state?.session.phase;
  const lastPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!phase || phase === lastPhase.current) return;
    const first = lastPhase.current === undefined;
    lastPhase.current = phase;
    if (first && phase === "free") return;
    const hasTeam = state?.me?.team != null;
    // Sharing starts where your private ideas are, if you have some to share.
    const toShare = state?.cards.some((card) => card.mine && card.space === "me");
    setTab(phase === "think" ? "me" : phase === "share" ? (hasTeam && !toShare ? "team" : "me") : phase === "free" ? tab : state && (phase === "vote" || phase === "build") ? bestTab(state as never) : "all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = state?.me;
  const cards = state?.cards ?? [];
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  // After voting, the most-voted ideas come first.
  const byVotes = phase === "build" || phase === "present";
  const inTab = (space: LiveSpace) => cards.filter((card) => card.space === space && (space !== "me" || card.mine))
    .sort((a, b) => (byVotes ? (b.votes ?? 0) - (a.votes ?? 0) : 0) || b.id - a.id);
  const voting = phase === "vote";
  const dotsLeft = (state?.session.votesPerPerson ?? 0) - (state?.votesUsed ?? 0);
  const shown = inTab(tab);
  const ended = state?.session.status === "ended";
  // New in the other tabs since you last looked.
  const newest = (space: LiveSpace) => Math.max(0, ...inTab(space).filter((card) => !card.mine).map((card) => card.id));
  useEffect(() => { setSeen((current) => ({ ...current, [tab]: Math.max(current[tab], newest(tab)) })); }, [tab, cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const unseen = (space: LiveSpace) => (space === tab ? 0 : inTab(space).filter((card) => !card.mine && card.id > seen[space]).length);

  const act = async (work: () => Promise<unknown>, failed: string) => {
    try { await work(); await refresh(); return true; }
    catch (failure) { toast({ variant: "destructive", title: failure instanceof LiveError ? failure.message : failed }); return false; }
  };
  const post = (path: string, json?: unknown, method = "POST") => liveFetch(`/api/live/${code}${path}`, { method, ...(json !== undefined ? { json } : {}) });

  if (!state) return (
    <div className="grid min-h-[100dvh] place-items-center p-6 text-center">
      {error ? <p className="text-sm text-muted-foreground">{error.message}</p> : <Loader2 className="animate-spin text-muted-foreground" />}
    </div>
  );
  const cardProps = (card: LiveCard) => ({
    parent: card.parentId ? byId.get(card.parentId) : undefined, copy, readOnly: ended, showTeam: card.space === "all",
    voting: voting && card.space !== "me", onVote: () => void act(() => post(`/cards/${card.id}/vote`), copy("It didn't work.", "لم ينجح.")),
    onReact: (emoji: string) => void act(() => post(`/cards/${card.id}/react`, { emoji }), copy("It didn't work.", "لم ينجح.")),
    onComment: (text: string) => act(() => post(`/cards/${card.id}/comments`, { text }), copy("The comment wasn't sent.", "لم يُرسل التعليق.")),
    onDeleteComment: (id: number) => void act(() => post(`/comments/${id}`, undefined, "DELETE"), copy("It didn't work.", "لم ينجح.")),
    onBuild: () => { setBuildOn(card); setOpenNote(null); if (tab === "all" && wallView === "board") setAdding(true); else window.scrollTo({ top: 0, behavior: "smooth" }); },
    onShare: (space: LiveSpace) => void act(async () => {
      await post(`/cards/${card.id}`, { space }, "PATCH");
      toast({ title: space === "team" ? copy("Shared with your team.", "شاركتها مع فريقك.") : space === "all" ? copy("Shared with everyone.", "شاركتها مع الجميع.") : copy("Moved back to Me.", "أعدتها إلى «أنا».") });
    }, copy("It couldn't be moved.", "تعذر النقل.")),
    onDelete: () => { if (window.confirm(copy("Delete this idea?", "حذف هذه الفكرة؟"))) void act(async () => { await post(`/cards/${card.id}`, undefined, "DELETE"); setOpenNote(null); }, copy("It couldn't be deleted.", "تعذر الحذف.")); },
  });
  // Voting and building go by the votes, so a ranked list is clearest then; otherwise the board.
  const listStep = voting || phase === "build";
  const board = tab === "all" && wallView === "board" && !listStep;
  const opened = openNote !== null ? cards.find((card) => card.id === openNote) : undefined;
  const team = me?.team ?? null;
  const teammates = state.people.filter((person) => team !== null && person.team === team);
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/90 px-4 py-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate font-serif text-lg leading-tight">{state.session.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {copy(`${state.people.length} people`, `${state.people.length} مشارك`)}
              {team !== null && <> · <span className="font-semibold" style={{ color: teamColor(team) }}>{copy(`Team ${team}`, `الفريق ${team}`)}</span></>}
            </p>
          </div>
          <span className="inline-flex max-w-[40%] items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-sm"><span className="text-lg leading-none">{me?.emoji}</span><span dir="auto" className="hidden truncate font-medium sm:inline">{me?.name}</span></span>
          <button type="button" onClick={() => setHelp(true)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-3 text-sm font-semibold text-primary" aria-label={copy("Help", "مساعدة")}><CircleHelp size={17} />{copy("Help", "مساعدة")}</button>
          <div className="shrink-0 scale-90"><LanguageToggle /></div>
        </div>
      </header>

      {error && <p className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status">{copy("Reconnecting…", "جارٍ إعادة الاتصال…")}</p>}
      {ended && <p className="bg-secondary px-4 py-2 text-center text-sm" role="status">{copy("This session has ended. You can still read everything.", "انتهت الجلسة. ما زال بإمكانك قراءة كل شيء.")}</p>}

      <main className="flex-1 space-y-4 px-4 pb-28 pt-4">
        <PhaseBanner state={state} copy={copy} extra={voting ? (
          <p className="mt-3 flex items-center gap-1.5 rounded-2xl bg-white/15 px-3 py-2 text-sm font-semibold">
            {copy("Your dots:", "نقاطك:")}
            {Array.from({ length: state.session.votesPerPerson }, (_, i) => <span key={i} className={`h-4 w-4 rounded-full ${i < dotsLeft ? "bg-white" : "border-2 border-white/60"}`} />)}
            <span className="ms-auto text-xs font-normal">{dotsLeft > 0 ? copy(`${dotsLeft} left`, `باقي ${dotsLeft}`) : copy("All used", "استُخدمت كلها")}</span>
          </p>
        ) : undefined} />
        <NextStep nudge={participantNudge(state as never, tab)} copy={copy} onGo={(space) => { setTab(space); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        {state.session.challenge && (
          <button type="button" onClick={() => setChallengeOpen((open) => !open)} aria-expanded={challengeOpen}
            className="block w-full rounded-3xl border border-amber-300/70 bg-gradient-to-br from-amber-50 to-card p-4 text-start dark:border-amber-800 dark:from-amber-950/30">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200"><Target size={14} />{copy("The challenge", "التحدي")}</span>
            <span dir="auto" className={`block whitespace-pre-wrap text-sm leading-6 ${challengeOpen ? "" : "line-clamp-2"}`}>{state.session.challenge}</span>
          </button>
        )}

        {tab === "team" && team === null ? (
          <div className="rounded-3xl border border-dashed p-8 text-center">
            <p className="text-4xl">🧩</p>
            <p className="mt-2 font-semibold">{copy("You're not in a team yet", "لست في فريق بعد")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy("Your instructor will put you in one. Meanwhile, write your ideas in Me.", "سيضعك المدرّب في فريق. حتى ذلك الحين اكتب أفكارك في «أنا».")}</p>
          </div>
        ) : (
          <>
            {tab === "team" && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-2xl px-1">
                <span className="me-1 text-xs font-bold" style={{ color: teamColor(team) }}>{copy(`Team ${team}`, `الفريق ${team}`)}</span>
                {teammates.map((person) => (
                  <span key={person.id} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">
                    <span>{person.emoji}</span><span dir="auto">{person.name}</span>{person.online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                  </span>
                ))}
              </div>
            )}
            {tab === "all" && listStep && <p className="rounded-2xl bg-pink-50 px-3 py-2 text-sm text-pink-900 dark:bg-pink-950/30 dark:text-pink-100">{voting ? copy("Voting: the board shows as a list, so you can put your dots quickly.", "التصويت: تظهر اللوحة كقائمة لتضع نقاطك بسرعة.") : copy("Building: the board shows as a list, most-voted first.", "التطوير: تظهر اللوحة كقائمة، الأعلى تصويتًا أولًا.")}</p>}
            {tab === "all" && !listStep && (
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-full bg-secondary p-1 text-sm" role="group" aria-label={copy("How to show it", "طريقة العرض")}>
                  {([["board", LayoutDashboard, copy("Board", "لوحة")], ["list", List, copy("List", "قائمة")]] as const).map(([value, Icon, label]) => (
                    <button key={value} type="button" onClick={() => chooseView(value)} aria-pressed={wallView === value} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold ${wallView === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}><Icon size={15} />{label}</button>
                  ))}
                </div>
                {board && !ended && phase !== "present" && (
                  <button type="button" onClick={() => setAdding(true)} className="ms-auto inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm"><StickyNote size={16} />{copy("Add a note", "أضف ملاحظة")}</button>
                )}
              </div>
            )}
            {board ? (
              <LiveBoard className="h-[calc(100dvh-15rem)] min-h-[22rem]" cards={shown} teamCount={state.session.teamCount} copy={copy} focusTeam={team ?? 0}
                canMove={(card) => card.mine && !ended} onOpen={(card) => setOpenNote(card.id)}
                onMove={(card, spot) => void act(() => post(`/cards/${card.id}`, spot, "PATCH"), copy("It couldn't be moved.", "تعذر النقل."))} />
            ) : (<>
            {!ended && !voting && phase !== "present" && (
              <Composer key={tab} code={code} space={tab} copy={copy} buildOn={buildOn} onClearBuild={() => setBuildOn(null)} onPosted={() => { setBuildOn(null); void refresh(); }} />
            )}
            {shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {tab === "me" ? copy("Your private ideas appear here. Only you can see them; share the good ones with your team.", "أفكارك الخاصة تظهر هنا ولا يراها غيرك. شارك الجيدة منها مع فريقك.")
                  : tab === "team" ? copy("No team ideas yet. Be the first!", "لا أفكار في الفريق بعد. كن الأول!")
                  : copy("Nothing on the wall yet.", "لا شيء على الحائط بعد.")}
              </p>
            ) : shown.map((card) => (
              <div key={card.id}>
                <LiveIdeaCard card={card} {...cardProps(card)} />
                {/* Private ideas: one tap to share. */}
                {card.space === "me" && !ended && (
                  <div className="mt-1.5 flex flex-wrap justify-end gap-1.5 px-2">
                    {team !== null && <button type="button" onClick={() => void act(() => post(`/cards/${card.id}`, { space: "team" }, "PATCH"), copy("It couldn't be shared.", "تعذرت المشاركة."))}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><Users size={13} />{copy("Share with my team", "شاركها مع فريقي")}</button>}
                    <button type="button" onClick={() => void act(() => post(`/cards/${card.id}`, { space: "all" }, "PATCH"), copy("It couldn't be shared.", "تعذرت المشاركة."))}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-semibold"><Globe2 size={13} />{copy("Share with everyone", "شاركها مع الجميع")}</button>
                  </div>
                )}
              </div>
            ))}
            </>)}
          </>
        )}
      </main>
      {/* A note opened on the board: everything you can do with it. */}
      {board && opened && (
        <Sheet label={copy("The note", "الملاحظة")} copy={copy} onClose={() => setOpenNote(null)}>
          <LiveIdeaCard card={opened} {...cardProps(opened)} />
          {opened.mine && !ended && (
            <div className="mt-3 flex items-center gap-1.5 px-1" role="group" aria-label={copy("Paper colour", "لون الورقة")}>
              <span className="me-1 text-xs text-muted-foreground">{copy("Colour", "اللون")}</span>
              {(Object.keys(NOTE_COLORS) as NoteColor[]).map((key) => (
                <button key={key} type="button" onClick={() => void act(() => post(`/cards/${opened.id}`, { color: key }, "PATCH"), copy("It didn't work.", "لم ينجح."))} aria-pressed={(opened.color ?? "yellow") === key} aria-label={copy(NOTE_COLORS[key].en, NOTE_COLORS[key].ar)}
                  className={`h-7 w-7 rounded-full border-2 ${(opened.color ?? "yellow") === key ? "border-foreground" : "border-transparent"}`} style={{ background: NOTE_COLORS[key].band }} />
              ))}
            </div>
          )}
        </Sheet>
      )}
      {board && adding && (
        <Sheet label={copy("Add a note to the board", "أضف ملاحظة إلى اللوحة")} copy={copy} onClose={() => { setAdding(false); setBuildOn(null); }}>
          <Composer code={code} space="all" copy={copy} buildOn={buildOn} withColor onClearBuild={() => setBuildOn(null)} onPosted={() => { setBuildOn(null); setAdding(false); void refresh(); toast({ title: copy("Pinned on the board.", "ثُبّتت على اللوحة.") }); }} />
        </Sheet>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label={copy("Spaces", "المساحات")}>
        <div className="mx-auto grid h-16 max-w-2xl grid-cols-3">
          {TABS.map(({ space, icon: Icon, en, ar }) => {
            const count = unseen(space);
            return (
              <button key={space} type="button" onClick={() => { setTab(space); window.scrollTo({ top: 0 }); }} aria-current={tab === space ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${tab === space ? "text-primary" : "text-muted-foreground"}`}>
                {tab === space && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" />}
                <span className="relative"><Icon size={22} />{count > 0 && <span className="absolute -end-3 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] text-white">{count > 9 ? "9+" : count}</span>}</span>
                <span className="leading-none">{space === "team" && team !== null ? copy(`Team ${team}`, `الفريق ${team}`) : copy(en, ar)}</span>
                <span className="text-[10px] font-normal leading-none opacity-75">{copy(TABS.find((one) => one.space === space)!.hintEn, TABS.find((one) => one.space === space)!.hintAr)}</span>
              </button>
            );
          })}
        </div>
      </nav>
      {intro && <Intro copy={copy} name={me?.name ?? ""} onDone={closeIntro} />}
      {help && <HelpSheet copy={copy} hasTeam={team !== null} onClose={() => setHelp(false)} onIntro={() => { setHelp(false); setIntro(true); }} />}
    </div>
  );
}

/** A sheet from the bottom of the screen. */
function Sheet({ label, copy, onClose, children }: { label: string; copy: Copy; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 backdrop-blur-[2px] sm:items-center" role="dialog" aria-modal="true" aria-label={label} onClick={onClose} data-testid="sheet">
      <div className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-[1.75rem] bg-background p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="font-semibold">{label}</p>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-secondary" aria-label={copy("Close", "إغلاق")}><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The one thing to do now, in plain words, with a button when it means going somewhere. */
function NextStep({ nudge, copy, onGo }: { nudge: ReturnType<typeof participantNudge>; copy: Copy; onGo: (space: LiveSpace) => void }) {
  const where = { me: copy("Go to Me", "اذهب إلى «أنا»"), team: copy("Go to my team", "اذهب إلى فريقي"), all: copy("Go to Everyone", "اذهب إلى «الجميع»") };
  return (
    <div className="flex items-center gap-3 rounded-3xl border-2 border-primary/25 bg-primary/[0.06] p-3.5" role="status" data-testid="next-step">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-background text-2xl shadow-sm">{nudge.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{copy("What to do now", "ماذا تفعل الآن")}</p>
        <p className="text-[15px] font-medium leading-snug">{copy(nudge.en, nudge.ar)}</p>
      </div>
      {nudge.go && (
        <button type="button" onClick={() => onGo(nudge.go!)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm">
          {where[nudge.go]}<ArrowRight size={15} className="rtl:rotate-180" />
        </button>
      )}
    </div>
  );
}

const HOW: Array<{ emoji: string; en: string; ar: string; moreEn: string; moreAr: string }> = [
  { emoji: "✍️", en: "Write your ideas", ar: "اكتب أفكارك", moreEn: "In Me, only you see them. Type, or tap Voice and just speak.", moreAr: "في «أنا» لا يراها غيرك. اكتب أو اضغط «صوت» وتكلم." },
  { emoji: "🤝", en: "Share the best ones", ar: "شارك أفضلها", moreEn: "Tap “Share with my team” under an idea. Comment on your team's ideas or build on them.", moreAr: "اضغط «شاركها مع فريقي» تحت الفكرة. علّق على أفكار فريقك أو ابنِ عليها." },
  { emoji: "🗳️", en: "Vote", ar: "صوّت", moreEn: "Put your dots on the ideas you like most.", moreAr: "ضع نقاطك على الأفكار التي تعجبك أكثر." },
];

/** First time in: how it works, in three steps. */
function Intro({ copy, name, onDone }: { copy: Copy; name: string; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label={copy("How it works", "كيف تعمل")} data-testid="intro">
      <div className="w-full max-w-md animate-[live-pop_0.4s_ease-out] rounded-[2rem] bg-card p-6 shadow-2xl">
        <p className="text-center text-4xl">👋</p>
        <h2 dir="auto" className="mt-2 text-center font-serif text-3xl">{copy(`Welcome${name ? `, ${name}` : ""}!`, `أهلًا${name ? ` ${name}` : ""}!`)}</h2>
        <p className="mt-1 text-center text-muted-foreground">{copy("It's easy. Three things:", "الأمر سهل. ثلاثة أشياء:")}</p>
        <ol className="mt-5 space-y-3">
          {HOW.map((step, i) => (
            <li key={i} className="flex gap-3 rounded-2xl bg-secondary/60 p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background text-2xl">{step.emoji}</span>
              <span><span className="block font-semibold">{i + 1}. {copy(step.en, step.ar)}</span><span className="block text-sm leading-snug text-muted-foreground">{copy(step.moreEn, step.moreAr)}</span></span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-2xl bg-primary/10 p-3 text-center text-sm font-medium text-primary">{copy("Don't worry about the order: the box at the top always tells you what to do now.", "لا تقلق بشأن الترتيب: المربع في الأعلى يخبرك دائمًا ماذا تفعل الآن.")}</p>
        <button type="button" onClick={onDone} autoFocus className="mt-5 h-14 w-full rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-md">{copy("Let's start", "لنبدأ")}</button>
      </div>
    </div>
  );
}

/** Stuck? Plain answers. */
function HelpSheet({ copy, hasTeam, onClose, onIntro }: { copy: Copy; hasTeam: boolean; onClose: () => void; onIntro: () => void }) {
  const faq: Array<[string, string, string, string]> = [
    ["Where do I write?", "أين أكتب؟", "In the white box near the top. Tap Post when you're done. You can also tap Voice and speak.", "في المربع الأبيض في الأعلى. اضغط «انشر» عند الانتهاء. ويمكنك الضغط على «صوت» والتحدث."],
    ["Who sees my ideas?", "من يرى أفكاري؟", "Ideas in Me: only you. In My team: your team. In Everyone: all people, and maybe the big screen.", "أفكار «أنا»: أنت فقط. «فريقي»: فريقك. «الجميع»: كل الحاضرين وربما الشاشة الكبيرة."],
    ["How do I share an idea?", "كيف أشارك فكرة؟", "Open Me. Under your idea, tap “Share with my team” (or “Share with everyone”).", "افتح «أنا». تحت فكرتك اضغط «شاركها مع فريقي» (أو «شاركها مع الجميع»)."],
    ["How do I vote?", "كيف أصوّت؟", "When voting starts, tap “Put a dot on this idea” on the ideas you like. Tap again to take the dot back.", "عندما يبدأ التصويت، اضغط «ضع نقطة على هذه الفكرة» على الأفكار التي تعجبك. اضغط مرة أخرى لاسترجاعها."],
    [hasTeam ? "Who's in my team?" : "I'm not in a team", hasTeam ? "من في فريقي؟" : "لست في فريق", hasTeam ? "Tap My team at the bottom: your teammates are listed at the top." : "That's fine: the host makes the teams. Until then, write your ideas in Me.", hasTeam ? "اضغط «فريقي» في الأسفل: أسماء زملائك في الأعلى." : "لا بأس: المضيف يكوّن الفرق. حتى ذلك الحين اكتب أفكارك في «أنا»."],
    ["I'm lost", "تهت", "Read the “What to do now” box at the top, and look at the big screen. Still stuck? Raise your hand: the host will come.", "اقرأ مربع «ماذا تفعل الآن» في الأعلى وانظر إلى الشاشة الكبيرة. ما زلت عالقًا؟ ارفع يدك وسيأتي المضيف."],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label={copy("Help", "مساعدة")} onClick={onClose} data-testid="help">
      <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-[2rem] bg-card p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-2xl"><CircleHelp className="text-primary" />{copy("Help", "مساعدة")}</h2>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-secondary" aria-label={copy("Close", "إغلاق")}><X size={18} /></button>
        </div>
        <div className="space-y-2">
          {faq.map(([qEn, qAr, aEn, aAr], i) => (
            <details key={i} className="rounded-2xl bg-secondary/60 p-3.5" open={i === 0}>
              <summary className="cursor-pointer list-none font-semibold">{copy(qEn, qAr)}</summary>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{copy(aEn, aAr)}</p>
            </details>
          ))}
        </div>
        <button type="button" onClick={onIntro} className="mt-4 h-12 w-full rounded-2xl border font-semibold">{copy("Show “How it works” again", "اعرض «كيف تعمل» مجددًا")}</button>
      </div>
    </div>
  );
}

/** Write, speak or photograph an idea, straight into the open space. */
function Composer({ code, space, copy, buildOn, onClearBuild, onPosted, withColor = false }: {
  code: string; space: LiveSpace; copy: Copy; buildOn: LiveCard | null; onClearBuild: () => void; onPosted: () => void; withColor?: boolean;
}) {
  const [color, setColor] = useState<NoteColor>(() => (remember("idea-live-note-color") as NoteColor) || "yellow");
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; started: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const photo = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (buildOn) area.current?.focus(); }, [buildOn]);
  useEffect(() => {
    if (!recording) return;
    const tick = window.setInterval(() => setSeconds(Math.round((Date.now() - recording.started) / 1000)), 500);
    return () => window.clearInterval(tick);
  }, [recording]);

  const where = space === "me" ? copy("Only you will see it", "لن يراها غيرك") : space === "team" ? copy("Your team will see it", "سيراها فريقك") : copy("Everyone will see it", "سيراها الجميع");
  const fail = (failure: unknown) => toast({ variant: "destructive", title: failure instanceof LiveError ? failure.message : copy("It wasn't sent. Check your connection.", "لم تُرسل. تحقّق من الاتصال.") });

  async function send() {
    if (!text.trim()) return;
    setBusy(copy("Posting…", "جارٍ النشر…"));
    try {
      await liveFetch(`/api/live/${code}/cards`, { method: "POST", json: { text: text.trim(), space, parentId: buildOn?.id ?? null, ...(withColor ? { color } : {}) } });
      setText("");
      onPosted();
    } catch (failure) { fail(failure); }
    finally { setBusy(null); }
  }
  async function upload(blob: Blob, label: string) {
    setBusy(label);
    try {
      const params = new URLSearchParams({ space, ...(text.trim() ? { text: text.trim() } : {}), ...(buildOn ? { parentId: String(buildOn.id) } : {}) });
      const response = await fetch(appPath(`/api/live/${code}/cards/media?${params}`, import.meta.env.BASE_URL), {
        method: "POST", body: blob, credentials: "same-origin", headers: { "Content-Type": (blob.type || "application/octet-stream").split(";")[0] },
      });
      if (!response.ok) throw new LiveError(response.status, ((await response.json().catch(() => ({}))) as { error?: string }).error ?? copy("It wasn't sent.", "لم تُرسل."));
      setText("");
      onPosted();
    } catch (failure) { fail(failure); }
    finally { setBusy(null); }
  }
  async function toggleVoice() {
    if (recording) { recording.recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((one) => MediaRecorder.isTypeSupported(one));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(null);
        setSeconds(0);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 1000) void upload(blob, copy("Writing out your voice…", "جارٍ تحويل صوتك إلى نص…"));
      };
      recorder.start(1000);
      setRecording({ recorder, started: Date.now() });
      // Long notes are cut at three minutes.
      window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 180_000);
    } catch { toast({ variant: "destructive", title: copy("The microphone isn't available. Allow it in the browser.", "الميكروفون غير متاح. اسمح به في المتصفح.") }); }
  }

  return (
    <section className="rounded-3xl border bg-card p-3 shadow-sm" aria-label={copy("New idea", "فكرة جديدة")}>
      {buildOn && (
        <div className="mb-2 flex items-start gap-2 rounded-2xl bg-primary/10 px-3 py-2 text-xs">
          <CornerDownRight size={14} className="mt-0.5 shrink-0 text-primary rtl:-scale-x-100" />
          <p dir="auto" className="line-clamp-2 min-w-0 flex-1">{copy("Building on", "تبني على")} <b>{buildOn.author?.name ?? copy("the instructor", "المدرّب")}</b>: “{buildOn.text}”</p>
          <button type="button" onClick={onClearBuild} aria-label={copy("Cancel", "إلغاء")}><X size={15} /></button>
        </div>
      )}
      {recording ? (
        <div className="flex h-24 items-center justify-center gap-3">
          <span className="relative flex h-4 w-4"><span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" /><span className="relative h-4 w-4 rounded-full bg-red-600" /></span>
          <span className="font-mono text-2xl tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
          <span className="text-sm text-muted-foreground">{copy("Speak your idea…", "قل فكرتك…")}</span>
        </div>
      ) : (
        <textarea ref={area} dir="auto" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={3} disabled={!!busy}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send(); }}
          placeholder={space === "me" ? copy("Write an idea… only you will see it", "اكتب فكرة… لن يراها غيرك") : copy("Write an idea…", "اكتب فكرة…")}
          aria-label={copy("Your idea", "فكرتك")} className="w-full resize-none bg-transparent px-1 text-base leading-7 outline-none placeholder:text-muted-foreground/70" />
      )}
      <div className="mt-1 flex items-center gap-2">
        <button type="button" onClick={() => void toggleVoice()} disabled={!!busy} aria-pressed={!!recording}
          className={`inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${recording ? "bg-red-600 text-white" : "bg-secondary"}`}>
          {recording ? <><Square size={15} />{copy("Stop", "إيقاف")}</> : <><Mic size={17} />{copy("Voice", "صوت")}</>}
        </button>
        <button type="button" onClick={() => photo.current?.click()} disabled={!!busy || !!recording} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-secondary px-4 text-sm font-semibold">
          <Camera size={17} />{copy("Photo", "صورة")}
        </button>
        <input ref={photo} type="file" accept="image/*" className="hidden" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(await shrinkPhoto(file), copy("Sending the photo…", "جارٍ إرسال الصورة…"));
        }} />
        <button type="button" onClick={() => void send()} disabled={!text.trim() || !!busy || !!recording}
          className="ms-auto inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition active:scale-95 disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="rtl:-scale-x-100" />}{copy("Post", "انشر")}
        </button>
      </div>
      {withColor && (
        <div className="mt-2 flex items-center gap-1.5 px-1" role="group" aria-label={copy("Paper colour", "لون الورقة")}>
          <span className="me-1 text-xs text-muted-foreground">{copy("Paper", "الورقة")}</span>
          {(Object.keys(NOTE_COLORS) as NoteColor[]).map((key) => (
            <button key={key} type="button" onClick={() => { setColor(key); remember("idea-live-note-color", key); }} aria-pressed={color === key} aria-label={copy(NOTE_COLORS[key].en, NOTE_COLORS[key].ar)}
              className={`h-7 w-7 rounded-full border-2 ${color === key ? "border-foreground" : "border-transparent"}`} style={{ background: NOTE_COLORS[key].paper, boxShadow: `inset 0 4px 0 ${NOTE_COLORS[key].band}` }} />
          ))}
        </div>
      )}
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground" role="status">{busy ?? where}</p>
    </section>
  );
}
