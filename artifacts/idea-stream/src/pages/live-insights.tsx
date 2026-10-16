import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { Activity, BarChart3, EyeOff, Handshake, Info, Loader2, Table2, Trophy, Users } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { liveFetch, teamColor, useLiveState, type LiveCard, type LivePerson } from "@/lib/live-api";

type Copy = (en: string, ar: string) => string;
type Member = {
  id: number; team: number | null; ideas: number; builds: number; privateIdeas: number; comments: number; reactions: number; votes: number;
  votesReceived: number; reactionsReceived: number; commentsReceived: number; buildsReceived: number; helpsOtherTeams: number;
  effort: number; impact: number; firstAt: string | null; lastAt: string | null;
};
type Team = {
  team: number; members: number[]; activeMembers: number; participation: number; ideas: number; builds: number; privateIdeas: number;
  comments: number; reactions: number; votes: number; votesReceived: number; helpsGiven: number; helpsReceived: number;
  effort: number; impact: number; effortPerPerson: number; impactPerPerson: number; evenness: number; topCardId: number | null; timeline: number[];
};
type Insights = { members: Member[]; teams: Team[]; start: string; now: string; timeline: number[]; effortPoints: Record<string, number>; impactPoints: Record<string, number> };

type MetricKey = "effort" | "impact" | "ideas" | "comments" | "helpsGiven" | "participation" | "effortPerPerson";
const METRICS: Array<{ key: MetricKey; en: string; ar: string; hintEn: string; hintAr: string; percent?: boolean }> = [
  { key: "effort", en: "Effort", ar: "الجهد", hintEn: "Everything the team did (points below)", hintAr: "كل ما فعله الفريق (النقاط بالأسفل)" },
  { key: "impact", en: "Impact", ar: "الأثر", hintEn: "How others responded to the team's ideas", hintAr: "كيف تفاعل الآخرون مع أفكار الفريق" },
  { key: "ideas", en: "Ideas", ar: "الأفكار", hintEn: "Ideas shared (not private ones)", hintAr: "الأفكار المشاركة (لا الخاصة)" },
  { key: "comments", en: "Comments", ar: "التعليقات", hintEn: "Comments written", hintAr: "التعليقات المكتوبة" },
  { key: "helpsGiven", en: "Help to other teams", ar: "مساعدة الفرق الأخرى", hintEn: "Comments, reactions, votes and build-ons on other teams' ideas", hintAr: "تعليقات وتفاعلات وأصوات وبناء على أفكار فرق أخرى" },
  { key: "participation", en: "Participation", ar: "المشاركة", hintEn: "Share of members who contributed", hintAr: "نسبة الأعضاء الذين ساهموا", percent: true },
  { key: "effortPerPerson", en: "Effort per person", ar: "الجهد لكل شخص", hintEn: "Effort divided by team size (fair for teams of different sizes)", hintAr: "الجهد مقسومًا على حجم الفريق (عادل للفرق المختلفة الحجم)" },
];
const teamName = (team: number, copy: Copy) => copy(`Team ${team}`, `الفريق ${team}`);
const fmt = (value: number, percent?: boolean) => (percent ? `${Math.round(value * 100)}%` : Number.isInteger(value) ? String(value) : value.toFixed(1));

/** A small hover tooltip, positioned at the pointer. */
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: React.ReactNode } | null>(null);
  const bind = (body: React.ReactNode) => ({
    onMouseMove: (event: React.MouseEvent) => setTip({ x: event.clientX, y: event.clientY, body }),
    onMouseLeave: () => setTip(null),
    onFocus: (event: React.FocusEvent) => { const r = (event.target as HTMLElement).getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top, body }); },
    onBlur: () => setTip(null),
  });
  const view = tip && (
    <div role="tooltip" className="pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg" style={{ left: tip.x, top: tip.y - 10 }}>{tip.body}</div>
  );
  return { bind, view };
}

/**
 * Team insights (the host only): every team compared on one measure at a time, then one team in
 * depth: how it compares with the average, its activity over time, and each member's contribution.
 */
export default function LiveInsightsPage() {
  const { id } = useParams<{ id: string }>();
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const { state } = useLiveState(`/api/live-admin/sessions/${id}/state`, 5000);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [metric, setMetric] = useState<MetricKey>("effort");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [selected, setSelected] = useState<number | null>(() => Number(new URLSearchParams(location.search).get("team")) || null);
  const [hideNames, setHideNames] = useState(false);
  const { bind, view: tipView } = useTip();

  useEffect(() => {
    let alive = true;
    const load = () => liveFetch<Insights>(`/api/live-admin/sessions/${id}/insights`).then((data) => { if (alive) setInsights(data); }).catch(() => {});
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [id, state?.version]);

  const people = useMemo(() => new Map((state?.people ?? []).map((person) => [person.id, person])), [state?.people]);
  const cards = useMemo(() => new Map((state?.cards ?? []).map((card) => [card.id, card])), [state?.cards]);
  if (!state || !insights) return <main className="grid min-h-[50vh] place-items-center"><Loader2 className="animate-spin text-primary" /></main>;

  const teams = insights.teams;
  // Hidden names: each person keeps the same number everywhere (the order they joined).
  const joined = new Map(state.people.map((person, index) => [person.id, index + 1]));
  const shownName = (person: LivePerson | undefined) => {
    const n = person ? joined.get(person.id) ?? 0 : 0;
    return hideNames ? copy(`Member ${n}`, `عضو ${n}`) : person?.name ?? "?";
  };
  const current = teams.find((team) => team.team === selected) ?? [...teams].sort((a, b) => b.effort - a.effort)[0];
  const best = (key: keyof Team) => (teams.length ? [...teams].sort((a, b) => (b[key] as number) - (a[key] as number))[0]! : null);
  const average = (key: keyof Team) => (teams.length ? teams.reduce((sum, team) => sum + (team[key] as number), 0) / teams.length : 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-1 sm:px-6">
      {tipView}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/live/${id}`} className="text-sm text-muted-foreground hover:text-foreground">{copy("Workshop control room", "غرفة تحكم الورشة")} · <span dir="auto">{state.session.title}</span></Link>
          <h1 className="mt-1 flex items-center gap-2 font-serif text-4xl"><BarChart3 className="text-primary" size={30} />{copy("Team insights", "تحليل الفرق")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy("Compare the teams, then open one to see each member's contribution. Updates live.", "قارن الفرق، ثم افتح فريقًا لترى مساهمة كل عضو. يتحدث مباشرة.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setHideNames((on) => !on)} aria-pressed={hideNames} className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${hideNames ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
            <EyeOff size={16} />{copy("Hide names (for the projector)", "إخفاء الأسماء (للعرض)")}
          </button>
          <a href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/live/${id}/pulse`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold"><Activity size={16} />{copy("Pulse screen", "شاشة النبض")}</a>
        </div>
      </div>

      {teams.length === 0 ? (
        <p className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">{copy("Make teams in the control room first: then they're compared here.", "كوّن الفرق من غرفة التحكم أولًا: ثم تُقارن هنا.")}</p>
      ) : (
        <>
          {/* Who stands out, at a glance. */}
          <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            {([
              ["effort", "🏃", copy("Most effort", "أكثر جهدًا")], ["impact", "⭐", copy("Most impact", "أكبر أثر")],
              ["helpsGiven", "🤝", copy("Most help to others", "الأكثر مساعدة للآخرين")], ["evenness", "⚖️", copy("Most even teamwork", "أكثر توازنًا في العمل")],
            ] as Array<[keyof Team, string, string]>).map(([key, emoji, label]) => {
              const team = best(key);
              const empty = !team || (team[key] as number) === 0;
              return (
                <button key={key} type="button" disabled={empty} onClick={() => team && setSelected(team.team)} className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-start shadow-sm transition hover:border-primary/40 disabled:opacity-60">
                  <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-2xl sm:grid">{emoji}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                    {empty ? <span className="text-sm text-muted-foreground">{copy("Not yet", "ليس بعد")}</span>
                      : <span className="flex items-center gap-1.5 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: teamColor(team!.team) }} />{teamName(team!.team, copy)}<span className="text-sm font-normal text-muted-foreground">· {fmt(team![key] as number, key === "evenness")}</span></span>}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 1. Teams compared. */}
          <section className="rounded-3xl border bg-card p-4 shadow-sm sm:p-5" aria-label={copy("Teams compared", "مقارنة الفرق")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif text-2xl">{copy("Teams compared", "مقارنة الفرق")}</h2>
              <div className="inline-flex rounded-full bg-secondary p-1 text-sm">
                {([["chart", BarChart3, copy("Chart", "رسم")], ["table", Table2, copy("Table", "جدول")]] as const).map(([value, Icon, label]) => (
                  <button key={value} type="button" onClick={() => setView(value)} aria-pressed={view === value} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium ${view === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}><Icon size={14} />{label}</button>
                ))}
              </div>
            </div>
            {view === "chart" ? (
              <>
                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={copy("Compare by", "قارن حسب")}>
                  {METRICS.map((one) => (
                    <button key={one.key} type="button" onClick={() => setMetric(one.key)} aria-pressed={metric === one.key}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${metric === one.key ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{copy(one.en, one.ar)}</button>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Info size={13} />{(() => { const m = METRICS.find((one) => one.key === metric)!; return copy(m.hintEn, m.hintAr); })()}</p>
                <RankedBars teams={teams} metric={metric} copy={copy} bind={bind} selected={current?.team ?? null} onSelect={setSelected} />
              </>
            ) : <CompareTable teams={teams} copy={copy} selected={current?.team ?? null} onSelect={setSelected} />}
            <p className="mt-4 rounded-2xl bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
              <b>{copy("Effort points", "نقاط الجهد")}:</b> {copy(`idea ${insights.effortPoints.idea} · build-on ${insights.effortPoints.build} · comment ${insights.effortPoints.comment} · private idea ${insights.effortPoints.privateIdea} · reaction ${insights.effortPoints.reaction} · vote ${insights.effortPoints.vote}`, `فكرة ${insights.effortPoints.idea} · بناء ${insights.effortPoints.build} · تعليق ${insights.effortPoints.comment} · فكرة خاصة ${insights.effortPoints.privateIdea} · تفاعل ${insights.effortPoints.reaction} · صوت ${insights.effortPoints.vote}`)}.{" "}
              <b>{copy("Impact points", "نقاط الأثر")}:</b> {copy(`vote received ${insights.impactPoints.voteReceived} · built on ${insights.impactPoints.buildReceived} · comment received ${insights.impactPoints.commentReceived} · reaction received ${insights.impactPoints.reactionReceived}`, `صوت مستلم ${insights.impactPoints.voteReceived} · بُني عليها ${insights.impactPoints.buildReceived} · تعليق مستلم ${insights.impactPoints.commentReceived} · تفاعل مستلم ${insights.impactPoints.reactionReceived}`)}.
              {" "}{copy("Private ideas count only as a number; nobody's words are read.", "الأفكار الخاصة تُحسب عددًا فقط؛ لا يُقرأ كلام أحد.")}
            </p>
          </section>

          {/* 2. One team in depth. */}
          {current && (
            <TeamDetail key={current.team} team={current} teams={teams} insights={insights} people={people} cards={cards} copy={copy} bind={bind} shownName={shownName}
              average={average} onTeam={setSelected} voting={state.session.phase === "vote"} />
          )}

          {/* 3. Everyone. */}
          <Everyone insights={insights} people={people} copy={copy} shownName={shownName} />
        </>
      )}
    </main>
  );
}

type Bind = (body: React.ReactNode) => Record<string, unknown>;

/** One bar per team, longest first; every bar names its team and value (never colour alone). */
function RankedBars({ teams, metric, copy, bind, selected, onSelect }: { teams: Team[]; metric: MetricKey; copy: Copy; bind: Bind; selected: number | null; onSelect: (team: number) => void }) {
  const percent = METRICS.find((one) => one.key === metric)?.percent;
  const sorted = [...teams].sort((a, b) => b[metric] - a[metric] || a.team - b.team);
  const max = Math.max(percent ? 1 : 0, ...teams.map((team) => team[metric])) || 1;
  return (
    <ol className="mt-4 space-y-2" data-testid="ranked-bars">
      {sorted.map((team, index) => (
        <li key={team.team}>
          <button type="button" onClick={() => onSelect(team.team)} aria-pressed={selected === team.team} {...bind(<TeamTip team={team} copy={copy} />)}
            className={`grid w-full grid-cols-[1.6rem_6.5rem_minmax(0,1fr)] items-center gap-2 rounded-xl px-1.5 py-1.5 text-start transition hover:bg-secondary/60 ${selected === team.team ? "bg-secondary/80 ring-1 ring-primary/30" : ""}`}>
            <span className="text-center text-sm font-bold tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="flex items-center gap-1.5 text-sm font-semibold"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: teamColor(team.team) }} />{teamName(team.team, copy)}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-6 rounded-e-[4px] rounded-s-[2px] transition-all duration-500" style={{ width: `${Math.max(team[metric] > 0 ? 2 : 0, (team[metric] / max) * 85)}%`, background: teamColor(team.team) }} />
              <span className="shrink-0 text-sm font-semibold tabular-nums">{fmt(team[metric], percent)}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function TeamTip({ team, copy }: { team: Team; copy: Copy }) {
  return (
    <span className="block space-y-0.5">
      <b className="block">{teamName(team.team, copy)} · {copy(`${team.members.length} people`, `${team.members.length} أشخاص`)}</b>
      <span className="block">{copy(`Effort ${team.effort} · Impact ${team.impact}`, `الجهد ${team.effort} · الأثر ${team.impact}`)}</span>
      <span className="block">{copy(`${team.ideas} ideas · ${team.comments} comments · ${team.helpsGiven} helps to others`, `${team.ideas} فكرة · ${team.comments} تعليق · ${team.helpsGiven} مساعدة`)}</span>
      <span className="block text-muted-foreground">{copy("Click to open the team", "اضغط لفتح الفريق")}</span>
    </span>
  );
}

/** Every measure for every team; the best in each row is bold, cells shaded by size. */
function CompareTable({ teams, copy, selected, onSelect }: { teams: Team[]; copy: Copy; selected: number | null; onSelect: (team: number) => void }) {
  const rows: Array<[string, (team: Team) => number, boolean?]> = [
    [copy("People", "الأشخاص"), (t) => t.members.length], [copy("Participation", "المشاركة"), (t) => t.participation, true],
    [copy("Effort", "الجهد"), (t) => t.effort], [copy("Effort per person", "الجهد لكل شخص"), (t) => t.effortPerPerson], [copy("Impact", "الأثر"), (t) => t.impact],
    [copy("Ideas shared", "أفكار مشاركة"), (t) => t.ideas], [copy("Build-ons", "بناء على أفكار"), (t) => t.builds], [copy("Private ideas", "أفكار خاصة"), (t) => t.privateIdeas],
    [copy("Comments", "تعليقات"), (t) => t.comments], [copy("Reactions", "تفاعلات"), (t) => t.reactions], [copy("Votes given", "أصوات مُعطاة"), (t) => t.votes],
    [copy("Votes received", "أصوات مستلمة"), (t) => t.votesReceived], [copy("Help to other teams", "مساعدة فرق أخرى"), (t) => t.helpsGiven], [copy("Help from other teams", "مساعدة من فرق أخرى"), (t) => t.helpsReceived],
    [copy("Evenness", "التوازن"), (t) => t.evenness, true],
  ];
  return (
    <div className="mt-4 overflow-x-auto" data-testid="compare-table">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky start-0 bg-card py-2 pe-3 text-start font-semibold text-muted-foreground">{copy("Measure", "المقياس")}</th>
            {teams.map((team) => (
              <th key={team.team} className="px-2 py-2 text-center">
                <button type="button" onClick={() => onSelect(team.team)} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${selected === team.team ? "bg-secondary" : ""}`}><span className="h-2 w-2 rounded-full" style={{ background: teamColor(team.team) }} />{teamName(team.team, copy)}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get, percent]) => {
            const values = teams.map(get);
            const max = Math.max(...values);
            return (
              <tr key={label} className="border-t">
                <td className="sticky start-0 border-t bg-card py-1.5 pe-3 text-muted-foreground">{label}</td>
                {teams.map((team, i) => (
                  <td key={team.team} className="border-t px-2 py-1.5 text-center tabular-nums" style={{ background: max > 0 ? `color-mix(in srgb, #3987e5 ${Math.round((values[i]! / max) * 22)}%, transparent)` : undefined }}>
                    <span className={values[i] === max && max > 0 ? "font-bold" : ""}>{fmt(values[i]!, percent)}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PARTS: Array<{ key: string; en: string; ar: string; shade: number; get: (m: Member) => number; points: (p: Record<string, number>) => number }> = [
  { key: "ideas", en: "Ideas & build-ons", ar: "أفكار وبناء", shade: 1, get: (m) => m.ideas + m.builds, points: (p) => p.idea },
  { key: "comments", en: "Comments", ar: "تعليقات", shade: 0.72, get: (m) => m.comments, points: (p) => p.comment },
  { key: "private", en: "Private ideas", ar: "أفكار خاصة", shade: 0.48, get: (m) => m.privateIdeas, points: (p) => p.privateIdea },
  { key: "reactions", en: "Reactions & votes", ar: "تفاعلات وأصوات", shade: 0.28, get: (m) => m.reactions + m.votes, points: (p) => p.reaction },
];

/** One team in depth: versus the average, activity over time, and each member. */
function TeamDetail({ team, teams, insights, people, cards, copy, bind, shownName, average, onTeam, voting }: {
  team: Team; teams: Team[]; insights: Insights; people: Map<number, LivePerson>; cards: Map<number, LiveCard>; copy: Copy; bind: Bind;
  shownName: (person: LivePerson | undefined) => string; average: (key: keyof Team) => number; onTeam: (team: number) => void; voting: boolean;
}) {
  const color = teamColor(team.team);
  const members = insights.members.filter((m) => m.team === team.team).sort((a, b) => b.effort - a.effort);
  const total = members.reduce((sum, m) => sum + m.effort, 0);
  const maxEffort = Math.max(1, ...members.map((m) => m.effort));
  const [open, setOpen] = useState<number | null>(null);
  const even = team.evenness >= 0.7 ? ["⚖️", copy("Shared evenly", "مُوزّع بالتساوي"), "text-emerald-700 dark:text-emerald-300"]
    : team.evenness >= 0.4 ? ["◐", copy("Somewhat uneven", "غير متوازن قليلًا"), "text-amber-700 dark:text-amber-300"]
    : ["⚠️", copy("One or two people doing most", "شخص أو اثنان يقومان بمعظم العمل"), "text-red-700 dark:text-red-300"];
  const compare: Array<[string, keyof Team, boolean?]> = [
    [copy("Effort per person", "الجهد لكل شخص"), "effortPerPerson"], [copy("Ideas", "الأفكار"), "ideas"], [copy("Comments", "التعليقات"), "comments"],
    [copy("Help to other teams", "مساعدة الفرق الأخرى"), "helpsGiven"], [copy("Impact", "الأثر"), "impact"], [copy("Participation", "المشاركة"), "participation", true],
  ];
  const maxSlice = Math.max(1, ...team.timeline);
  const ideas = [...cards.values()].filter((card) => card.space !== "me" && !card.hidden && card.author?.team === team.team && !card.parentId)
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || b.reactions.reduce((n, r) => n + r.count, 0) - a.reactions.reduce((n, r) => n + r.count, 0)).slice(0, 5);
  return (
    <section className="mt-6 overflow-hidden rounded-3xl border bg-card shadow-sm" aria-label={teamName(team.team, copy)} data-team-detail={team.team} style={{ borderTop: `5px solid ${color}` }}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/30 px-4 py-2">
        <span className="text-sm text-muted-foreground">{copy("Open a team:", "افتح فريقًا:")}</span>
        {teams.map((one) => (
          <button key={one.team} type="button" onClick={() => onTeam(one.team)} aria-pressed={one.team === team.team}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${one.team === team.team ? "bg-background shadow-sm" : "border-transparent text-muted-foreground"}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: teamColor(one.team) }} />{teamName(one.team, copy)}
          </button>
        ))}
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="font-serif text-3xl" style={{ color }}>{teamName(team.team, copy)}</h2>
          <span className="text-sm text-muted-foreground">{copy(`${team.members.length} people · ${team.activeMembers} contributed`, `${team.members.length} أشخاص · ${team.activeMembers} ساهموا`)}</span>
          <span className={`text-sm font-semibold ${even[2]}`}>{even[0]} {even[1]}</span>
        </div>

        {/* Versus the average of all teams. */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="vs-average">
          {compare.map(([label, key, percent]) => {
            const value = team[key] as number, avg = average(key);
            const diff = avg > 0 ? (value - avg) / avg : 0;
            return (
              <div key={key} className="rounded-2xl bg-secondary/50 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-2xl font-black tabular-nums">{fmt(value, percent)}</p>
                <p className={`text-xs font-semibold ${Math.abs(diff) < 0.1 ? "text-muted-foreground" : diff > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                  {Math.abs(diff) < 0.1 ? copy("≈ average", "≈ المتوسط") : `${diff > 0 ? "▲" : "▼"} ${Math.round(Math.abs(diff) * 100)}% ${copy(diff > 0 ? "above average" : "below average", diff > 0 ? "فوق المتوسط" : "تحت المتوسط")}`}
                </p>
                <p className="text-[11px] text-muted-foreground">{copy(`average ${fmt(avg, percent)}`, `المتوسط ${fmt(avg, percent)}`)}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* Each member's contribution. */}
          <div>
            <h3 className="flex items-center gap-1.5 font-semibold"><Users size={17} />{copy("Each member's contribution", "مساهمة كل عضو")}</h3>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label={copy("Legend", "مفتاح الألوان")}>
              {PARTS.map((part) => <span key={part.key} className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm" style={{ background: color, opacity: part.shade }} />{copy(part.en, part.ar)}</span>)}
            </p>
            <ol className="mt-3 space-y-2" data-testid="members">
              {members.map((member, index) => {
                const person = people.get(member.id);
                const share = total > 0 ? member.effort / total : 0;
                return (
                  <li key={member.id} className="rounded-2xl border bg-background/60 p-2.5">
                    <button type="button" onClick={() => setOpen(open === member.id ? null : member.id)} aria-expanded={open === member.id} className="grid w-full grid-cols-[2rem_minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-2 text-start">
                      <span className="relative text-2xl leading-none">{person?.emoji ?? "🙂"}{person?.online && <span className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />}</span>
                      <span className="min-w-0">
                        <span dir="auto" className="block truncate text-sm font-semibold">{shownName(person)}</span>
                        <span className="block text-xs text-muted-foreground">{copy(`${Math.round(share * 100)}% of the team`, `${Math.round(share * 100)}% من الفريق`)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-5 min-w-0 gap-[2px]" style={{ width: `${(member.effort / maxEffort) * 80}%` }}>
                          {PARTS.map((part) => {
                            const points = part.get(member) * part.points(insights.effortPoints);
                            if (!points) return null;
                            return <span key={part.key} className="h-full first:rounded-s-[2px] last:rounded-e-[4px]" style={{ flexGrow: points, background: color, opacity: part.shade }}
                              {...bind(<span><b>{shownName(person)}</b>: {part.get(member)} {copy(part.en, part.ar).toLowerCase()} ({points} {copy("points", "نقطة")})</span>)} />;
                          })}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums">{member.effort}</span>
                        {member.effort === 0 && <span className="text-xs text-muted-foreground">{copy("nothing yet", "لا شيء بعد")}</span>}
                      </span>
                    </button>
                    {open === member.id && (
                      <div className="mt-2 grid gap-2 border-t pt-2 text-sm sm:grid-cols-2">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                          <dt className="text-muted-foreground">{copy("Ideas shared", "أفكار مشاركة")}</dt><dd className="tabular-nums">{member.ideas}</dd>
                          <dt className="text-muted-foreground">{copy("Built on others", "بنى على غيره")}</dt><dd className="tabular-nums">{member.builds}</dd>
                          <dt className="text-muted-foreground">{copy("Private ideas", "أفكار خاصة")}</dt><dd className="tabular-nums">{member.privateIdeas}</dd>
                          <dt className="text-muted-foreground">{copy("Comments", "تعليقات")}</dt><dd className="tabular-nums">{member.comments}</dd>
                          <dt className="text-muted-foreground">{copy("Reactions · votes", "تفاعلات · أصوات")}</dt><dd className="tabular-nums">{member.reactions} · {member.votes}</dd>
                          <dt className="text-muted-foreground">{copy("Helped other teams", "ساعد فرقًا أخرى")}</dt><dd className="tabular-nums">{member.helpsOtherTeams}</dd>
                        </dl>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                          <dt className="font-semibold">{copy("Impact", "الأثر")}</dt><dd className="font-semibold tabular-nums">{member.impact}</dd>
                          <dt className="text-muted-foreground">{copy("Votes received", "أصوات مستلمة")}</dt><dd className="tabular-nums">{voting ? "—" : member.votesReceived}</dd>
                          <dt className="text-muted-foreground">{copy("Comments received", "تعليقات مستلمة")}</dt><dd className="tabular-nums">{member.commentsReceived}</dd>
                          <dt className="text-muted-foreground">{copy("Others built on it", "بنى عليها آخرون")}</dt><dd className="tabular-nums">{member.buildsReceived}</dd>
                          <dt className="text-muted-foreground">{copy("Active", "نشط")}</dt><dd className="tabular-nums">{member.firstAt ? `${new Date(member.firstAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${new Date(member.lastAt!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "—"}</dd>
                        </dl>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="space-y-6">
            {/* Activity over time. */}
            <div>
              <h3 className="font-semibold">{copy("Activity over time", "النشاط عبر الوقت")}</h3>
              <div className="mt-3 flex h-28 items-end gap-[2px] border-b border-border" data-testid="timeline" aria-label={copy("Activity over time", "النشاط عبر الوقت")}>
                {team.timeline.map((count, i) => (
                  <span key={i} className="relative flex h-full flex-1 items-end" {...bind(<span>{copy(`${count} actions`, `${count} نشاط`)}</span>)}>
                    <span className="w-full rounded-t-[4px] transition-all duration-500" style={{ height: `${(count / maxSlice) * 100}%`, minHeight: count ? 3 : 0, background: color }} />
                  </span>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{new Date(insights.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                <span>{copy("now", "الآن")}</span>
              </div>
            </div>
            {/* Help across teams. */}
            <div className="flex gap-3">
              <div className="flex-1 rounded-2xl bg-secondary/50 p-3"><p className="flex items-center gap-1 text-xs text-muted-foreground"><Handshake size={13} />{copy("Helped other teams", "ساعد فرقًا أخرى")}</p><p className="text-2xl font-black tabular-nums">{team.helpsGiven}</p></div>
              <div className="flex-1 rounded-2xl bg-secondary/50 p-3"><p className="flex items-center gap-1 text-xs text-muted-foreground"><Handshake size={13} />{copy("Got help from others", "تلقى مساعدة")}</p><p className="text-2xl font-black tabular-nums">{team.helpsReceived}</p></div>
            </div>
            {/* The team's best ideas. */}
            <div>
              <h3 className="flex items-center gap-1.5 font-semibold"><Trophy size={16} className="text-amber-500" />{copy("The team's top ideas", "أفضل أفكار الفريق")}</h3>
              {ideas.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{copy("No shared ideas yet.", "لا أفكار مشاركة بعد.")}</p> : (
                <ol className="mt-2 space-y-1.5">
                  {ideas.map((card) => (
                    <li key={card.id} className="rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                      <span dir="auto" className="line-clamp-2">{card.text || "📷"}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{!voting && card.votes ? `● ${card.votes} · ` : ""}{card.reactions.filter((r) => r.count).map((r) => `${r.emoji} ${r.count}`).join(" ")}{card.comments.length ? ` · 💬 ${card.comments.length}` : ""}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type SortKey = "effort" | "impact" | "ideas" | "comments" | "helpsOtherTeams" | "votesReceived";
/** All members of the workshop in one table, sortable. */
function Everyone({ insights, people, copy, shownName }: { insights: Insights; people: Map<number, LivePerson>; copy: Copy; shownName: (person: LivePerson | undefined) => string }) {
  const [sort, setSort] = useState<SortKey>("effort");
  const rows = [...insights.members].sort((a, b) => b[sort] - a[sort] || a.id - b.id);
  const cols: Array<[SortKey, string]> = [["effort", copy("Effort", "الجهد")], ["impact", copy("Impact", "الأثر")], ["ideas", copy("Ideas", "الأفكار")], ["comments", copy("Comments", "التعليقات")], ["helpsOtherTeams", copy("Help to other teams", "مساعدة الفرق")], ["votesReceived", copy("Votes received", "أصوات مستلمة")]];
  return (
    <section className="mt-6 rounded-3xl border bg-card p-4 shadow-sm sm:p-5" aria-label={copy("Everyone", "الجميع")}>
      <h2 className="font-serif text-2xl">{copy("Everyone", "الجميع")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy("Click a column to sort. Only you see this page.", "اضغط عمودًا للترتيب. لا يرى هذه الصفحة غيرك.")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm" data-testid="everyone">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-2 text-start font-semibold">{copy("Member", "العضو")}</th>
              <th className="py-2 text-start font-semibold">{copy("Team", "الفريق")}</th>
              {cols.map(([key, label]) => (
                <th key={key} className="py-2 text-end font-semibold" aria-sort={sort === key ? "descending" : "none"}>
                  <button type="button" onClick={() => setSort(key)} className={`rounded-full px-2 py-0.5 ${sort === key ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{label}{sort === key ? " ↓" : ""}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((member, index) => {
              const person = people.get(member.id);
              return (
                <tr key={member.id} className="border-t">
                  <td className="py-1.5"><span className="me-1.5">{person?.emoji}</span><span dir="auto">{shownName(person)}</span></td>
                  <td className="py-1.5">{member.team ? <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: teamColor(member.team) }} />{teamName(member.team, copy)}</span> : "—"}</td>
                  {cols.map(([key]) => <td key={key} className={`py-1.5 text-end tabular-nums ${sort === key ? "font-bold" : ""}`}>{member[key]}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
