import { useEffect, useState } from "react";
import { Activity, ArrowRight, BarChart3, StickyNote, Check, FileDown, Loader2, Megaphone, Minus, MonitorPlay, Plus, Shuffle, SkipForward, Sparkles, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appPath } from "@/lib/app-path";
import { PHASE_INFO, clockText, useCountdown, type LivePhase, type LiveState } from "@/lib/live-api";
import { HOST_STEPS, hostStep, suggestTeamSize, type HostStepId } from "@/lib/live-guide";

type Copy = (en: string, ar: string) => string;
type Call = (path: string, method: string, json?: unknown) => Promise<unknown>;
type Act = (work: () => Promise<unknown>, failed?: string) => Promise<boolean>;

const MINUTES: Partial<Record<HostStepId, number>> = { think: 5, share: 8, vote: 3, build: 10, present: 0 };
const PHASES: HostStepId[] = ["think", "share", "vote", "build", "present"];
const LABEL: Record<HostStepId, [string, string, string]> = {
  challenge: ["🎯", "The challenge", "التحدي"], screen: ["📽️", "The screen", "الشاشة"], join: ["📱", "People join", "الانضمام"], teams: ["🧩", "Teams", "الفرق"],
  think: ["🤔", "Think alone", "فكّر وحدك"], share: ["🤝", "Share", "شارك"], vote: ["🗳️", "Vote", "صوّت"], build: ["🛠️", "Build", "طوّر"], present: ["🎤", "Present", "اعرض"], wrap: ["🏁", "Wrap up", "الختام"],
};

/**
 * Running the workshop, one step at a time: what to do now, what to say to the room, and one big
 * button for it. The full controls stay below for anything else.
 */
export function HostGuide({ state, copy, call, act, onReport, reporting }: { state: LiveState; copy: Copy; call: Call; act: Act; onReport: () => void; reporting: boolean }) {
  const session = state.session;
  const key = `idea-live-host-${session.id}`;
  const [done, setDone] = useState<Set<HostStepId>>(() => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify([...done])); } catch { /* optional */ } }, [key, done]);
  const mark = (...steps: HostStepId[]) => setDone((all) => new Set([...all, ...steps]));
  const [minutes, setMinutes] = useState<Partial<Record<HostStepId, number>>>(MINUTES);
  const [teamSize, setTeamSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(session.phaseEndsAt, state.now);
  const step = hostStep(state as never, done);
  const index = HOST_STEPS.indexOf(step);
  const running = PHASES.includes(step) && session.phase === step;
  const people = state.people.length;
  const size = teamSize ?? suggestTeamSize(people);
  const presenter = appPath(`/live/${session.id}/present`, import.meta.env.BASE_URL);
  const pulse = appPath(`/live/${session.id}/pulse`, import.meta.env.BASE_URL);
  const privateIdeas = Object.values(state.privateCounts ?? {}).reduce((sum, n) => sum + n, 0);
  const shared = state.cards.filter((card) => card.space !== "me" && !card.hidden).length;
  const dots = state.cards.reduce((sum, card) => sum + (card.votes ?? 0), 0);

  // Starting a step: everything before it counts as done.
  const start = (phase: HostStepId) => act(async () => {
    await call(`/sessions/${session.id}`, "PATCH", { phase, minutes: minutes[phase] ?? 0 });
    mark(...HOST_STEPS.slice(0, HOST_STEPS.indexOf(phase)));
  });
  const nextPhase = PHASES[PHASES.indexOf(step) + 1] as (HostStepId & LivePhase) | undefined;

  const say = (en: string, ar: string) => (
    <p className="mt-3 flex gap-2 rounded-2xl bg-background/80 p-3 text-base leading-7 shadow-sm">
      <Megaphone size={18} className="mt-1 shrink-0 text-primary rtl:-scale-x-100" />
      <span><span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{copy("Say to the room", "قل للحاضرين")}</span><span dir="auto">“{copy(en, ar)}”</span></span>
    </p>
  );
  const minuteControl = (phase: HostStepId) => (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-1 py-0.5 text-sm">
      <button type="button" onClick={() => setMinutes((all) => ({ ...all, [phase]: Math.max(1, (all[phase] ?? 1) - 1) }))} className="grid h-7 w-7 place-items-center rounded-full hover:bg-secondary" aria-label={copy("Less time", "وقت أقل")}><Minus size={13} /></button>
      <span className="min-w-[3.2rem] text-center font-semibold tabular-nums"><Timer size={13} className="me-1 inline" />{minutes[phase]} {copy("min", "د")}</span>
      <button type="button" onClick={() => setMinutes((all) => ({ ...all, [phase]: Math.min(60, (all[phase] ?? 0) + 1) }))} className="grid h-7 w-7 place-items-center rounded-full hover:bg-secondary" aria-label={copy("More time", "وقت أكثر")}><Plus size={13} /></button>
    </span>
  );

  let body: React.ReactNode;
  if (step === "challenge") body = (
    <>
      <p className="text-muted-foreground">{copy("Write the one question everyone will work on, in the box “The challenge” below. Tip: start with “How might we…”.", "اكتب السؤال الذي سيعمل عليه الجميع في مربع «التحدي» بالأسفل. نصيحة: ابدأ بـ «كيف يمكننا…».")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-12 rounded-full px-6 text-base" onClick={() => { const box = document.querySelector<HTMLTextAreaElement>("[data-challenge]"); box?.scrollIntoView({ behavior: "smooth", block: "center" }); box?.focus(); }}>{copy("Write the challenge", "اكتب التحدي")}<ArrowRight size={18} className="ms-2 rtl:rotate-180" /></Button>
        <Button variant="ghost" className="h-12 rounded-full" onClick={() => mark("challenge")}><SkipForward size={16} className="me-1.5 rtl:rotate-180" />{copy("Skip", "تخطَّ")}</Button>
      </div>
    </>
  );
  else if (step === "screen") body = (
    <>
      <p className="text-muted-foreground">{copy("Connect your laptop to the projector, then open the screen with the big join code and QR. Press F there for full screen.", "صِل حاسوبك بجهاز العرض ثم افتح شاشة رمز الانضمام وQR. اضغط F هناك لملء الشاشة.")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild className="h-12 rounded-full px-6 text-base" onClick={() => mark("screen")}><a href={presenter} target="_blank" rel="noreferrer"><MonitorPlay size={18} className="me-2" />{copy("Open the projector screen", "افتح شاشة العرض")}</a></Button>
        <Button variant="ghost" className="h-12 rounded-full" onClick={() => mark("screen")}><SkipForward size={16} className="me-1.5 rtl:rotate-180" />{copy("No projector", "بلا جهاز عرض")}</Button>
      </div>
    </>
  );
  else if (step === "join") body = (
    <>
      <p className="flex items-baseline gap-2"><span className="text-4xl font-black tabular-nums">{people}</span><span className="text-muted-foreground">{copy(people === 1 ? "person has joined" : "people have joined", "انضموا حتى الآن")}</span></p>
      {people > 0 && <p className="mt-1 line-clamp-2 text-xl">{state.people.slice(-30).map((person) => person.emoji).join(" ")}</p>}
      {say("Take out your phone, scan the QR code on the screen, type your name and tap Join. No app or account needed.", "أخرج هاتفك، امسح رمز QR على الشاشة، اكتب اسمك واضغط «انضم». لا حاجة لتطبيق أو حساب.")}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-12 rounded-full px-6 text-base" disabled={people === 0} onClick={() => mark("join")}><Check size={18} className="me-2" />{copy("Everyone's in: next", "انضم الجميع: التالي")}</Button>
      </div>
    </>
  );
  else if (step === "teams") body = (
    <>
      <p className="text-muted-foreground">{copy(`Put the ${people} people in small teams. For ${people} people, teams of ${suggestTeamSize(people)} work well.`, `وزّع ${people} شخصًا على فرق صغيرة. لـ ${people} شخصًا تناسب فرق من ${suggestTeamSize(people)}.`)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-muted-foreground">{copy("People per team", "أشخاص لكل فريق")}</span>
        {[2, 3, 4, 5, 6].map((value) => (
          <button key={value} type="button" onClick={() => setTeamSize(value)} aria-pressed={size === value} className={`h-9 w-9 rounded-full border text-sm font-semibold ${size === value ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{value}</button>
        ))}
      </div>
      {say("You'll see your team on your phone. Sit together with your team.", "سترى فريقك على هاتفك. اجلس مع أعضاء فريقك.")}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-12 rounded-full px-6 text-base" disabled={people < 2 || busy} onClick={async () => { setBusy(true); if (await act(() => call(`/sessions/${session.id}/teams`, "POST", { size }))) mark("challenge", "screen", "join", "teams"); setBusy(false); }}>
          {busy ? <Loader2 size={18} className="me-2 animate-spin" /> : <Shuffle size={18} className="me-2" />}{copy(`Make teams of ${size}`, `كوّن فرقًا من ${size}`)}
        </Button>
        <Button variant="ghost" className="h-12 rounded-full" onClick={() => mark("teams")}><SkipForward size={16} className="me-1.5 rtl:rotate-180" />{copy("Work all together (no teams)", "العمل معًا (بلا فرق)")}</Button>
      </div>
    </>
  );
  else if (step === "wrap") body = (
    <>
      <p className="text-muted-foreground">{copy("Well done! Let the AI group the ideas into themes and show them on the screen (press 5 there), take the report, then end the workshop.", "أحسنت! دع الذكاء الاصطناعي يجمع الأفكار في محاور واعرضها على الشاشة (اضغط 5 هناك)، خذ التقرير ثم أنهِ الورشة.")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="h-12 rounded-full bg-gradient-to-r from-violet-600 to-indigo-500 px-6 text-base" disabled={busy || shared < 3} onClick={async () => { setBusy(true); await act(() => call(`/sessions/${session.id}/synthesize`, "POST", {}), copy("The ideas couldn't be read.", "تعذرت قراءة الأفكار.")); setBusy(false); }}>
          {busy ? <Loader2 size={18} className="me-2 animate-spin" /> : <Sparkles size={18} className="me-2" />}{session.synthesis ? copy("Themes ready ✓ (again)", "المحاور جاهزة ✓ (أعد)") : copy("Group the ideas into themes", "جمّع الأفكار في محاور")}
        </Button>
        <Button asChild variant="outline" className="h-12 rounded-full"><a href={appPath(`/live/${session.id}/insights`, import.meta.env.BASE_URL)}><BarChart3 size={16} className="me-1.5" />{copy("Team insights", "تحليل الفرق")}</a></Button>
        <Button variant="outline" className="h-12 rounded-full" disabled={reporting} onClick={onReport}>{reporting ? <Loader2 size={16} className="me-1.5 animate-spin" /> : <FileDown size={16} className="me-1.5" />}{copy("Report (PDF)", "التقرير (PDF)")}</Button>
        {session.status !== "ended" && <Button variant="ghost" className="h-12 rounded-full" onClick={() => { if (window.confirm(copy("End the workshop? Everyone can still read, but no one can add ideas.", "إنهاء الورشة؟ يمكن للجميع القراءة دون إضافة أفكار."))) void act(() => call(`/sessions/${session.id}`, "PATCH", { status: "ended" })); }}>{copy("End the workshop", "أنهِ الورشة")}</Button>}
      </div>
    </>
  );
  else {
    const info = PHASE_INFO[step as LivePhase];
    const lines: Record<string, [string, string]> = {
      think: ["On your own first: write as many ideas as you can in “Me”. Nobody sees them yet.", "أولًا وحدك: اكتب أكبر عدد من الأفكار في «أنا». لا يراها أحد بعد."],
      share: ["Now share your best ideas with your team, read theirs, and build on them.", "الآن شارك أفضل أفكارك مع فريقك، اقرأ أفكارهم وابنِ عليها."],
      vote: [`Put your ${session.votesPerPerson} dots on the ideas you like most. You can't vote for your own.`, `ضع نقاطك الـ${session.votesPerPerson} على الأفكار التي تعجبك أكثر. لا يمكنك التصويت لفكرتك.`],
      build: ["Take your team's top idea and make it real: how would it work? What's needed?", "خذ الفكرة الأعلى في فريقك واجعلها واقعية: كيف ستعمل؟ وما المطلوب؟"],
      present: ["Each team: one minute to present your best idea.", "كل فريق: دقيقة واحدة لعرض أفضل فكرة."],
    };
    const progress = step === "think" ? copy(`${privateIdeas} private ideas written so far`, `${privateIdeas} فكرة خاصة كُتبت حتى الآن`)
      : step === "share" || step === "build" ? copy(`${shared} ideas shared`, `${shared} فكرة مشاركة`)
      : step === "vote" ? copy(`${dots} of ${people * session.votesPerPerson} dots placed`, `وُضعت ${dots} من ${people * session.votesPerPerson} نقطة`) : null;
    body = running ? (
      <>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold text-white" style={{ background: info.color }}>● {copy("Running now", "يجري الآن")}</span>
          {left !== null && <span className={`font-mono text-3xl font-black tabular-nums ${left <= 30 ? "text-red-600" : ""}`}>{left > 0 ? clockText(left) : copy("Time's up!", "انتهى الوقت!")}</span>}
          {progress && <span className="text-sm text-muted-foreground">{progress}</span>}
        </div>
        {say(...lines[step]!)}
        <p className="mt-2 text-sm text-muted-foreground">{copy("Everyone's phone shows this step and tells them what to do. Walk around and help; on the projector, Pulse shows which teams are busy.", "تعرض هواتف الجميع هذه الخطوة وتخبرهم ماذا يفعلون. تجوّل وساعد؛ وعلى جهاز العرض تُظهر «النبض» الفرق النشطة.")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {nextPhase ? (
            <>
              <Button className="h-12 rounded-full px-6 text-base" onClick={() => void start(nextPhase)}>{copy(`Next: ${LABEL[nextPhase][1]}`, `التالي: ${LABEL[nextPhase][2]}`)}<ArrowRight size={18} className="ms-2 rtl:rotate-180" /></Button>
              {(minutes[nextPhase] ?? 0) > 0 && minuteControl(nextPhase)}
            </>
          ) : (
            <Button className="h-12 rounded-full px-6 text-base" onClick={() => mark("present")}><Check size={18} className="me-2" />{copy("All teams presented: wrap up", "عرضت كل الفرق: الختام")}</Button>
          )}
          {left !== null && <Button variant="outline" className="h-12 rounded-full" onClick={() => void act(() => call(`/sessions/${session.id}`, "PATCH", { addMinutes: 1 }))}><Plus size={16} className="me-1" />{copy("1 more minute", "دقيقة إضافية")}</Button>}
          <Button asChild variant="ghost" className="h-12 rounded-full"><a href={pulse} target="_blank" rel="noreferrer"><Activity size={16} className="me-1.5" />{copy("Pulse screen", "شاشة النبض")}</a></Button>
          <Button asChild variant="ghost" className="h-12 rounded-full"><a href={appPath(`/live/${session.id}/board`, import.meta.env.BASE_URL)} target="_blank" rel="noreferrer"><StickyNote size={16} className="me-1.5" />{copy("The board", "اللوحة")}</a></Button>
        </div>
      </>
    ) : (
      <>
        <p className="text-muted-foreground">{copy(info.doEn, info.doAr)}</p>
        {say(...lines[step]!)}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button className="h-12 rounded-full px-6 text-base" style={{ background: info.color }} onClick={() => void start(step)}>{info.emoji} {copy(`Start: ${info.en}`, `ابدأ: ${info.ar}`)}</Button>
          {(minutes[step] ?? 0) > 0 && minuteControl(step)}
          <Button variant="ghost" className="h-12 rounded-full" onClick={() => mark(step)}><SkipForward size={16} className="me-1.5 rtl:rotate-180" />{copy("Skip this step", "تخطَّ هذه الخطوة")}</Button>
        </div>
      </>
    );
  }

  return (
    <section className="mb-6 overflow-hidden rounded-[2rem] border-2 border-primary/30 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-md" aria-label={copy("Run the workshop", "إدارة الورشة")} data-host-step={step}>
      {/* Where you are: every step, the current one big. */}
      <ol className="flex gap-1 overflow-x-auto border-b bg-background/60 px-3 py-2">
        {HOST_STEPS.map((id, i) => {
          const isNow = id === step, isDone = i < index || done.has(id);
          return (
            <li key={id} className="shrink-0">
              <button type="button" disabled={!PHASES.includes(id) || isNow} onClick={() => { if (window.confirm(copy(`Go to “${LABEL[id][1]}” now? Everyone's phone moves to it.`, `الانتقال إلى «${LABEL[id][2]}» الآن؟ تنتقل هواتف الجميع إليها.`))) void start(id); }}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${isNow ? "bg-primary text-primary-foreground" : isDone ? "text-primary" : "text-muted-foreground"} ${PHASES.includes(id) && !isNow ? "hover:bg-secondary" : ""}`}>
                <span>{isDone && !isNow ? "✓" : LABEL[id][0]}</span>{copy(LABEL[id][1], LABEL[id][2])}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">{copy(`Step ${index + 1} of ${HOST_STEPS.length} · What to do now`, `الخطوة ${index + 1} من ${HOST_STEPS.length} · ماذا تفعل الآن`)}</p>
        <h2 className="mt-1 flex items-center gap-2 font-serif text-3xl"><span>{LABEL[step][0]}</span>{copy(LABEL[step][1], LABEL[step][2])}</h2>
        <div className="mt-2">{body}</div>
      </div>
    </section>
  );
}
