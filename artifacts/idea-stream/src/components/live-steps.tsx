import { useState } from "react";
import { Eraser, Loader2, Plus, Sparkles, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHASE_INFO, clockText, useCountdown, type LivePhase, type LiveState } from "@/lib/live-api";

type Copy = (en: string, ar: string) => string;
type Call = (path: string, method: string, json?: unknown) => Promise<unknown>;
type Act = (work: () => Promise<unknown>, failed?: string) => Promise<boolean>;

const STEPS: Array<{ phase: LivePhase; minutes: number }> = [
  { phase: "think", minutes: 5 }, { phase: "share", minutes: 8 }, { phase: "vote", minutes: 3 }, { phase: "build", minutes: 10 }, { phase: "present", minutes: 0 },
];

/**
 * Leading the room: one tap moves everyone to the next step (with its timer); the timer can get
 * more time or stop; voting has a number of dots per person.
 */
export function StepsPanel({ state, copy, call, act }: { state: LiveState; copy: Copy; call: Call; act: Act }) {
  const session = state.session;
  const left = useCountdown(session.phaseEndsAt, state.now);
  const [minutes, setMinutes] = useState<Record<string, number>>(() => Object.fromEntries(STEPS.map((step) => [step.phase, step.minutes])));
  const go = (phase: LivePhase) => act(() => call(`/sessions/${session.id}`, "PATCH", { phase, minutes: minutes[phase] ?? 0 }));
  const info = PHASE_INFO[session.phase];
  const voters = state.people.length;
  const votesCast = state.cards.reduce((sum, card) => sum + (card.votes ?? 0), 0);
  return (
    <section className="mt-6 rounded-3xl border bg-card p-5 shadow-sm" aria-label={copy("Steps", "الخطوات")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">{copy("All the steps", "كل الخطوات")}</h2>
        <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold text-white" style={{ background: info.color }}>
          <span>{info.emoji}</span>{copy(`Now: ${info.en}`, `الآن: ${info.ar}`)}
          {left !== null && <span className="ms-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 font-mono tabular-nums"><Timer size={14} />{clockText(left)}</span>}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{copy("For jumping around: tap any step and everyone's phone switches to it, with a countdown. The guide at the top does this for you, in order.", "للتنقل الحر: اضغط أي خطوة فتنتقل هواتف الجميع إليها مع عدّ تنازلي. الدليل في الأعلى يفعل ذلك لك بالترتيب.")}</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-5">
        {STEPS.map((step, index) => {
          const current = session.phase === step.phase;
          const stepInfo = PHASE_INFO[step.phase];
          return (
            <li key={step.phase} className={`rounded-2xl border-2 p-3 transition ${current ? "shadow-md" : "border-transparent bg-secondary/50"}`} style={current ? { borderColor: stepInfo.color } : undefined}>
              <button type="button" onClick={() => void go(step.phase)} className="w-full text-start">
                <span className="text-xs font-semibold text-muted-foreground">{index + 1}</span>
                <span className="mt-0.5 flex items-center gap-1.5 font-semibold"><span className="text-xl">{stepInfo.emoji}</span>{copy(stepInfo.en, stepInfo.ar)}</span>
              </button>
              <label className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Timer size={12} />
                <input type="number" min={0} max={120} value={minutes[step.phase] ?? 0} onChange={(event) => setMinutes((all) => ({ ...all, [step.phase]: Math.max(0, Math.min(120, Number(event.target.value) || 0)) }))}
                  className="h-7 w-12 rounded-md border bg-background px-1.5 text-center text-foreground" aria-label={copy(`${stepInfo.en} minutes`, `دقائق ${stepInfo.ar}`)} />
                {copy("min", "د")}
              </label>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {left !== null && (
          <>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => void act(() => call(`/sessions/${session.id}`, "PATCH", { addMinutes: 1 }))}><Plus size={14} className="me-1" />{copy("1 minute", "دقيقة")}</Button>
            <Button size="sm" variant="ghost" className="rounded-full" onClick={() => void act(() => call(`/sessions/${session.id}`, "PATCH", { stopTimer: true }))}><Square size={13} className="me-1" />{copy("Stop the timer", "أوقف المؤقت")}</Button>
          </>
        )}
        {session.phase !== "free" && <Button size="sm" variant="ghost" className="rounded-full" onClick={() => void act(() => call(`/sessions/${session.id}`, "PATCH", { phase: "free" }))}>{copy("Back to open", "عودة إلى المفتوح")}</Button>}
        <span className="ms-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          {copy("Dots per person", "نقاط لكل شخص")}
          {[1, 2, 3, 5].map((n) => (
            <button key={n} type="button" onClick={() => void act(() => call(`/sessions/${session.id}`, "PATCH", { votesPerPerson: n }))} aria-pressed={session.votesPerPerson === n}
              className={`h-7 w-7 rounded-full border text-xs font-semibold ${session.votesPerPerson === n ? "border-pink-600 bg-pink-600 text-white" : "bg-background"}`}>{n}</button>
          ))}
          {votesCast > 0 && (
            <button type="button" onClick={() => { if (window.confirm(copy("Remove all votes?", "حذف كل الأصوات؟"))) void act(() => call(`/sessions/${session.id}/votes/clear`, "POST")); }}
              className="ms-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs hover:bg-secondary"><Eraser size={12} />{copy(`Clear ${votesCast} votes`, `امسح ${votesCast} صوتًا`)}</button>
          )}
        </span>
      </div>
      {session.phase === "vote" && <p className="mt-2 text-xs text-muted-foreground">{copy(`${votesCast} of ${voters * session.votesPerPerson} dots placed. People see only their own dots until voting ends.`, `وُضعت ${votesCast} من ${voters * session.votesPerPerson} نقطة. لا يرى الناس إلا نقاطهم حتى ينتهي التصويت.`)}</p>}
    </section>
  );
}

/** The AI's reading of the room: summary, themes with their ideas, standouts, what's missing. */
export function ThemesPanel({ state, copy, call, act }: { state: LiveState; copy: Copy; call: Call; act: Act }) {
  const [busy, setBusy] = useState(false);
  const synthesis = state.session.synthesis;
  const byId = new Map(state.cards.map((card) => [card.id, card]));
  const shared = state.cards.filter((card) => card.space !== "me" && !card.hidden).length;
  async function read() {
    setBusy(true);
    try { await act(() => call(`/sessions/${state.session.id}/synthesize`, "POST", {}), copy("The ideas couldn't be read.", "تعذرت قراءة الأفكار.")); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-8" aria-label={copy("Themes", "المحاور")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-serif text-2xl"><Sparkles size={20} className="text-violet-600" />{copy("What the room is saying", "ما تقوله القاعة")}</h2>
        <Button className="rounded-full bg-gradient-to-r from-violet-600 to-indigo-500" disabled={busy || shared < 3} onClick={() => void read()}>
          {busy ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <Sparkles size={15} className="me-1.5" />}
          {synthesis ? copy("Read the ideas again", "اقرأ الأفكار مجددًا") : copy("Group the ideas into themes", "جمّع الأفكار في محاور")}
        </Button>
      </div>
      {!synthesis ? (
        <p className="rounded-3xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {shared < 3 ? copy("When at least 3 ideas are shared, the AI can group them into themes, pick standouts and spot what's missing.", "عند مشاركة 3 أفكار على الأقل يمكن للذكاء الاصطناعي تجميعها في محاور واختيار الأبرز وكشف ما ينقص.")
            : copy(`The AI reads the ${shared} shared ideas (never private ones) and groups them into themes.`, `يقرأ الذكاء الاصطناعي ${shared} فكرة مشتركة (لا الخاصة أبدًا) ويجمعها في محاور.`)}
        </p>
      ) : (
        <div className="space-y-3">
          {synthesis.summary && <p dir="auto" className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 font-serif text-lg leading-relaxed text-white shadow-lg">{synthesis.summary}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {synthesis.themes.map((theme, index) => (
              <details key={index} className="group rounded-2xl border bg-card p-4 shadow-sm" open={index < 2}>
                <summary className="flex cursor-pointer list-none items-start gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-600 text-sm font-bold text-white">{theme.cardIds.length}</span>
                  <span className="min-w-0">
                    <span dir="auto" className="block font-semibold">{theme.title}</span>
                    <span dir="auto" className="block text-sm text-muted-foreground">{theme.summary}</span>
                  </span>
                </summary>
                <ul className="mt-3 space-y-1.5 ps-11 text-sm">
                  {theme.cardIds.map((id) => byId.get(id)).filter(Boolean).map((card) => (
                    <li key={card!.id} dir="auto" className="rounded-xl bg-muted/50 px-3 py-1.5">{card!.text}<span className="ms-1 text-xs text-muted-foreground">— {card!.author?.name ?? copy("Instructor", "المدرّب")}{card!.votes ? ` · ● ${card!.votes}` : ""}</span></li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          {synthesis.standouts.length > 0 && (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="mb-2 text-sm font-bold text-amber-900 dark:text-amber-200">{copy("Worth discussing", "تستحق النقاش")}</p>
              <ul className="space-y-2 text-sm">
                {synthesis.standouts.map((standout) => byId.get(standout.cardId) && (
                  <li key={standout.cardId} dir="auto"><b>“{byId.get(standout.cardId)!.text}”</b> <span className="text-muted-foreground">— {standout.why}</span></li>
                ))}
              </ul>
            </div>
          )}
          {synthesis.gaps.length > 0 && (
            <div className="rounded-2xl border p-4">
              <p className="mb-1 text-sm font-bold">{copy("Not covered yet: ask the room", "لم تُغطَّ بعد: اسأل القاعة")}</p>
              <ul className="list-disc space-y-1 ps-5 text-sm">{synthesis.gaps.map((gap, i) => <li key={i} dir="auto">{gap}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
