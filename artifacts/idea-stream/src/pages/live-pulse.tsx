import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, Handshake, LayoutGrid, Loader2, Maximize, MessageCircle, Play, Square, Users, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { PHASE_INFO, clockText, showCode, teamColor, useCountdown, useLiveState, type LiveCard, type LivePerson, type LivePulse, type LiveState } from "@/lib/live-api";
import { ago, badgeSpot, roomStatus, ringLayout, tileSize, tourOrder, type RoomStatus } from "@/lib/live-pulse-view";

type Copy = (en: string, ar: string) => string;
type Selection = { kind: "link" | "similar"; a: number; b: number } | null;
type Room = {
  team: number; people: LivePerson[]; cards: LiveCard[]; comments: number; reactions: number; votes: number;
  lastAt: string | undefined; status: RoomStatus;
};

/**
 * Workshop Pulse: the whole workshop on the projector. Every team with its people and what they're
 * doing, lines where teams help each other or think alike, and a live feed. The instructor clicks a
 * team to show everything inside it. Private ("Me") ideas never appear here.
 */
export default function LivePulsePage() {
  const { id } = useParams<{ id: string }>();
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const { state } = useLiveState(`/api/live-admin/sessions/${id}/state?pulse=1`, 2000);
  const [focus, setFocus] = useState(-1); // -1: all teams
  const [selection, setSelection] = useState<Selection>(null);
  const [touring, setTouring] = useState(false);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  useEffect(() => { if (state?.now) offset.current = Date.parse(state.now) - Date.now(); }, [state?.now]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() + offset.current), 3000); return () => window.clearInterval(timer); }, []);

  const rooms = useMemo(() => (state ? buildRooms(state, now) : []), [state, now]);
  const teams = rooms.map((room) => room.team);

  // The auto tour: the overview, then each team in turn; any click takes over.
  const tourStep = useRef(0);
  useEffect(() => {
    if (!touring || !state?.pulse) return;
    const order = tourOrder(teams.filter(Boolean), state.pulse.lastActivity);
    const timer = window.setInterval(() => {
      tourStep.current = (tourStep.current + 1) % order.length;
      setSelection(null);
      setFocus(order[tourStep.current] || -1);
    }, 14_000);
    return () => window.clearInterval(timer);
  }, [touring, teams.join(","), state?.pulse?.lastActivity]);
  const choose = (team: number) => { setTouring(false); setSelection(null); setFocus(team); };
  const step = (by: number) => {
    if (!teams.length) return;
    const index = teams.indexOf(focus);
    choose(index < 0 ? teams[0]! : teams[(index + by + teams.length) % teams.length]!);
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") { setSelection(null); choose(-1); }
      if (event.key.toLowerCase() === "f") void document.documentElement.requestFullscreen?.().catch(() => {});
      if (event.key.toLowerCase() === "t") { tourStep.current = 0; setTouring((on) => !on); }
      if (event.key === "ArrowRight") step(isArabic ? -1 : 1);
      if (event.key === "ArrowLeft") step(isArabic ? 1 : -1);
      if (/^[1-9]$/.test(event.key) && teams.includes(Number(event.key))) choose(Number(event.key));
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  if (!state?.pulse) return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950 text-white"><Loader2 className="animate-spin" /></div>;
  const pulse = state.pulse;
  const voting = state.session.phase === "vote";
  const room = rooms.find((one) => one.team === focus);
  const shared = state.cards.filter((card) => card.space !== "me" && !card.hidden);
  const online = state.people.filter((person) => person.online).length;
  const helpsCount = pulse.helps.filter((help) => !(voting && help.kind === "vote")).length;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_center,#132036_0%,#0a1020_55%,#04070d_100%)] text-white" data-testid="pulse">
      <TopBar state={state} copy={copy} stats={[
        [String(online), copy(`of ${state.people.length} online`, `من ${state.people.length} متصلون`)],
        [`${rooms.filter((one) => one.status === "active").length}/${teams.filter(Boolean).length || rooms.length}`, copy("teams active", "فرق نشطة")],
        [String(shared.filter((card) => card.author).length), copy("ideas shared", "فكرة مشاركة")],
        [String(shared.reduce((sum, card) => sum + card.comments.length, 0)), copy("comments", "تعليق")],
        [String(helpsCount), copy("helps across teams", "مساعدة بين الفرق")],
      ]} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_25vw] gap-[1.2vw] px-[1.6vw] pb-[1.4vw]">
        <div className="relative min-h-0">
          {room ? <RoomView room={room} state={state} pulse={pulse} copy={copy} now={now} voting={voting} onBack={() => choose(-1)} onStep={step} />
            : <Ring rooms={rooms} pulse={pulse} voting={voting} copy={copy} now={now} selection={selection} onRoom={choose} onSelect={(next) => { setTouring(false); setSelection(next); }} unassigned={state.people.filter((person) => person.team === null && teams.some(Boolean))} />}
        </div>
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.2vw] bg-white/[0.05] p-[1vw] ring-1 ring-white/10">
          {selection ? <SelectionPanel selection={selection} state={state} pulse={pulse} voting={voting} copy={copy} onClose={() => setSelection(null)} />
            : <Feed state={state} pulse={pulse} copy={copy} now={now} voting={voting} only={room?.team ?? null} />}
        </aside>
      </div>

      {/* The instructor's controls: faint until hovered (keys: T tour, F full screen, Esc overview, ← → teams, 1–9). */}
      <div className="group fixed bottom-0 start-1/2 z-30 -translate-x-1/2 p-3 rtl:translate-x-1/2">
        <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 opacity-25 backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={() => choose(-1)} aria-pressed={!room} className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${!room ? "bg-white text-slate-900" : "text-white"}`}><LayoutGrid size={16} />{copy("All teams", "كل الفرق")}</button>
          <button type="button" onClick={() => { tourStep.current = 0; setTouring((on) => !on); }} aria-pressed={touring} className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${touring ? "bg-emerald-400 text-slate-900" : "text-white"}`}>
            {touring ? <Square size={14} /> : <Play size={15} />}{touring ? copy("Stop tour", "أوقف الجولة") : copy("Tour the teams", "جولة على الفرق")}
          </button>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10" aria-label={copy("Full screen", "ملء الشاشة")}><Maximize size={16} /></button>
          <button type="button" onClick={() => { if (window.opener) window.close(); else history.back(); }} className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10" aria-label={copy("Close", "إغلاق")}><X size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function buildRooms(state: LiveState, now: number): Room[] {
  const teamOf = new Map(state.people.map((person) => [person.id, person.team]));
  const roomOf = (card: LiveCard) => card.team ?? (card.author ? teamOf.get(card.author.id) ?? null : null) ?? 0;
  const shared = state.cards.filter((card) => card.space !== "me" && !card.hidden && card.author);
  // No teams yet: everyone is one room.
  const teams = state.session.teamCount > 0 ? Array.from({ length: state.session.teamCount }, (_, i) => i + 1) : [0];
  return teams.map((team) => {
    const cards = shared.filter((card) => (team === 0 ? true : roomOf(card) === team)).sort((a, b) => b.id - a.id);
    const lastAt = team === 0 ? Object.values(state.pulse?.lastActivity ?? {}).sort().pop() ?? state.pulse?.feed[0]?.at : state.pulse?.lastActivity[team];
    return {
      team, cards, lastAt, status: roomStatus(lastAt, now),
      people: state.people.filter((person) => (team === 0 ? true : person.team === team)),
      comments: cards.reduce((sum, card) => sum + card.comments.length, 0),
      reactions: cards.reduce((sum, card) => sum + card.reactions.reduce((n, reaction) => n + reaction.count, 0), 0),
      votes: cards.reduce((sum, card) => sum + (card.votes ?? 0), 0),
    };
  });
}

const teamName = (team: number, copy: Copy) => (team ? copy(`Team ${team}`, `الفريق ${team}`) : copy("Everyone", "الجميع"));

function TopBar({ state, copy, stats }: { state: LiveState; copy: Copy; stats: Array<[string, string]> }) {
  const phase = PHASE_INFO[state.session.phase];
  const left = useCountdown(state.session.phaseEndsAt, state.now);
  return (
    <header className="flex items-center gap-[1.4vw] px-[1.6vw] py-[1vw]">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-[0.6vw] text-[0.95vw] font-bold uppercase tracking-[0.3em] text-rose-300">
          <span className="relative inline-flex h-[0.8vw] w-[0.8vw]"><span data-pulse-anim className="absolute inset-0 animate-[pulse-beat_1.6s_ease-in-out_infinite] rounded-full bg-rose-500" /><span className="relative h-full w-full rounded-full bg-rose-500" /></span>
          {copy("Workshop Pulse · Live", "نبض الورشة · مباشر")}
        </p>
        <h1 dir="auto" className="truncate font-serif text-[2.1vw] leading-tight text-white">{state.session.title}</h1>
      </div>
      <span className="inline-flex shrink-0 items-center gap-[0.5vw] rounded-full px-[1vw] py-[0.35vw] text-[1.05vw] font-semibold" style={{ background: `${phase.color}33`, color: "#fff", boxShadow: `inset 0 0 0 1px ${phase.color}` }}>
        {phase.emoji} {copy(phase.en, phase.ar)}{left !== null && <span className="font-mono tabular-nums">{clockText(left)}</span>}
      </span>
      <dl className="flex shrink-0 gap-[1.4vw]">
        {stats.map(([value, label]) => (
          <div key={label} className="text-center">
            <dt className="sr-only">{label}</dt>
            <dd className="text-[1.9vw] font-black tabular-nums leading-none">{value}</dd>
            <dd className="mt-[0.2vw] text-[0.75vw] uppercase tracking-wider text-white/55">{label}</dd>
          </div>
        ))}
      </dl>
      <p className="shrink-0 rounded-[0.8vw] bg-white/10 px-[0.9vw] py-[0.4vw] text-center font-mono text-[1.3vw] font-bold leading-tight" dir="ltr">
        <span className="block font-sans text-[0.65vw] font-semibold uppercase tracking-widest text-white/60">{copy("Join", "انضم")}</span>{showCode(state.session.code)}
      </p>
    </header>
  );
}

function StatusPill({ status, copy, big = false }: { status: RoomStatus; copy: Copy; big?: boolean }) {
  const look = { active: ["bg-emerald-400 text-slate-900", copy("Active now", "نشط الآن")], quiet: ["bg-amber-300/90 text-slate-900", copy("Quiet", "هادئ")], waiting: ["bg-white/15 text-white/70", copy("Waiting", "بانتظار")] }[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-[0.35vw] rounded-full font-bold ${big ? "px-[1vw] py-[0.3vw] text-[1.1vw]" : "px-[0.6vw] py-[0.1vw] text-[0.75vw]"} ${look[0]}`} data-status={status}>
      {status === "active" && <span data-pulse-anim className="h-[0.5vw] w-[0.5vw] animate-[pulse-beat_1.2s_ease-in-out_infinite] rounded-full bg-slate-900" />}{look[1]}
    </span>
  );
}

function Ring({ rooms, pulse, voting, copy, now, selection, onRoom, onSelect, unassigned }: {
  rooms: Room[]; pulse: LivePulse; voting: boolean; copy: Copy; now: number; selection: Selection;
  onRoom: (team: number) => void; onSelect: (selection: Selection) => void; unassigned: LivePerson[];
}) {
  const spots = ringLayout(rooms.length);
  const size = tileSize(rooms.length);
  const at = new Map(rooms.map((room, index) => [room.team, spots[index]!]));
  // While voting, who voted for what stays off the big screen.
  const links = pulse.links.map((link) => ({ ...link, count: link.count - (voting ? link.kinds.vote ?? 0 : 0) })).filter((link) => link.count > 0 && at.has(link.a) && at.has(link.b)).slice(0, 10);
  const similar = pulse.similar.filter((pair) => at.has(pair.a) && at.has(pair.b) && !links.some((link) => link.a === pair.a && link.b === pair.b)).slice(0, 5);
  const strongest = Math.max(1, ...links.map((link) => link.count));
  const fresh = (a: number, b: number) => pulse.helps.some((help) => ((help.from === a && help.to === b) || (help.from === b && help.to === a)) && now - Date.parse(help.at) < 60_000);
  const isSelected = (kind: "link" | "similar", a: number, b: number) => selection?.kind === kind && selection.a === a && selection.b === b;
  return (
    <div className="absolute inset-0">
      {rooms.length > 1 && (
        <div className="pointer-events-none absolute start-0 top-0 z-0 flex max-w-[16vw] items-start gap-[0.5vw] text-white/35">
          <Handshake className="h-[1.4vw] w-[1.4vw] shrink-0" />
          <p className="text-[0.8vw] leading-snug">{copy("Lines show teams helping each other; dashed lines, teams with similar ideas.", "الخطوط تُظهر الفرق التي تساعد بعضها؛ والمتقطعة فرقًا بأفكار متشابهة.")}</p>
        </div>
      )}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {links.map((link) => (
            <linearGradient key={`g${link.a}-${link.b}`} id={`pulse-g${link.a}-${link.b}`} gradientUnits="userSpaceOnUse" x1={at.get(link.a)!.x} y1={at.get(link.a)!.y} x2={at.get(link.b)!.x} y2={at.get(link.b)!.y}>
              <stop offset="0" stopColor={teamColor(link.a)} /><stop offset="1" stopColor={teamColor(link.b)} />
            </linearGradient>
          ))}
        </defs>
        {similar.map((pair) => (
          <line key={`s${pair.a}-${pair.b}`} x1={at.get(pair.a)!.x} y1={at.get(pair.a)!.y} x2={at.get(pair.b)!.x} y2={at.get(pair.b)!.y}
            stroke="#c4b5fd" strokeOpacity={isSelected("similar", pair.a, pair.b) ? 1 : 0.55} strokeWidth={isSelected("similar", pair.a, pair.b) ? 3 : 2} strokeDasharray="6 7" vectorEffect="non-scaling-stroke" />
        ))}
        {links.map((link) => (
          <line key={`l${link.a}-${link.b}`} data-link={`${link.a}-${link.b}`} x1={at.get(link.a)!.x} y1={at.get(link.a)!.y} x2={at.get(link.b)!.x} y2={at.get(link.b)!.y}
            stroke={`url(#pulse-g${link.a}-${link.b})`} strokeOpacity={isSelected("link", link.a, link.b) ? 1 : 0.85} strokeLinecap="round" vectorEffect="non-scaling-stroke"
            strokeWidth={3 + (link.count / strongest) * 9} strokeDasharray={fresh(link.a, link.b) ? "14 6" : undefined}
            style={fresh(link.a, link.b) ? { animation: "pulse-flow 0.8s linear infinite" } : undefined} data-pulse-anim />
        ))}
      </svg>
      {/* Badges on the lines: click to see who helped whom. */}
      {similar.map((pair) => {
        const spot = badgeSpot(at.get(pair.a)!, at.get(pair.b)!, spots, size);
        return (
          <button key={`sb${pair.a}-${pair.b}`} type="button" onClick={() => onSelect({ kind: "similar", a: pair.a, b: pair.b })} data-similar={`${pair.a}-${pair.b}`}
            className="absolute z-20 max-w-[14vw] -translate-x-1/2 -translate-y-1/2 truncate rounded-full bg-violet-500/80 px-[0.7vw] py-[0.15vw] text-[0.8vw] font-semibold text-white shadow-lg ring-1 ring-violet-200/40 hover:bg-violet-500"
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }} dir="auto">≈ {pair.words.slice(0, 2).join(" · ")}</button>
        );
      })}
      {links.map((link) => {
        const spot = badgeSpot(at.get(link.a)!, at.get(link.b)!, spots, size);
        return (
          <button key={`lb${link.a}-${link.b}`} type="button" onClick={() => onSelect({ kind: "link", a: link.a, b: link.b })} data-link-badge={`${link.a}-${link.b}`}
            className="absolute z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-[0.3vw] rounded-full bg-white px-[0.7vw] py-[0.15vw] text-[0.95vw] font-black text-slate-900 shadow-xl hover:scale-110"
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>🤝 {link.count}</button>
        );
      })}
      {rooms.map((room, index) => (
        <RoomTile key={room.team} room={room} copy={copy} now={now} voting={voting} compact={size.w < 17} onOpen={() => onRoom(room.team)}
          style={{ left: `${spots[index]!.x}%`, top: `${spots[index]!.y}%`, width: `${size.w}%`, height: `${size.h}%` }} />
      ))}
      {unassigned.length > 0 && (
        <p className="absolute bottom-0 start-0 z-20 flex max-w-[40%] items-center gap-[0.5vw] truncate rounded-full bg-white/10 px-[0.8vw] py-[0.25vw] text-[0.85vw] text-white/70">
          {copy("Not in a team yet:", "لم ينضموا لفريق:")} {unassigned.slice(0, 12).map((person) => person.emoji).join(" ")}
        </p>
      )}
    </div>
  );
}

function RoomTile({ room, copy, now, voting, compact, onOpen, style }: { room: Room; copy: Copy; now: number; voting: boolean; compact: boolean; onOpen: () => void; style: React.CSSProperties }) {
  const color = teamColor(room.team || null);
  const online = room.people.filter((person) => person.online).length;
  const latest = room.cards[0];
  return (
    <button type="button" onClick={onOpen} data-room={room.team} aria-label={teamName(room.team, copy)}
      className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[1.1vw] bg-slate-900/95 p-[0.8vw] text-start shadow-2xl ring-1 ring-white/10 transition hover:scale-[1.03] hover:ring-white/40"
      style={{ ...style, borderTop: `0.35vw solid ${color}`, ["--pulse-color" as string]: `${color}cc` }}>
      {/* Lights up whenever something happens in the team. */}
      {room.lastAt && now - Date.parse(room.lastAt) < 20_000 && <span key={room.lastAt} data-pulse-anim className="pointer-events-none absolute inset-0 animate-[pulse-flash_1.8s_ease-out] rounded-[1.1vw]" />}
      <span className="flex items-center gap-[0.5vw]">
        <span className="truncate text-[1.25vw] font-black" style={{ color }}>{teamName(room.team, copy)}</span>
        <span className="ms-auto"><StatusPill status={room.status} copy={copy} /></span>
      </span>
      <span className="mt-[0.4vw] flex flex-wrap gap-[0.2vw] text-[1.3vw] leading-none">
        {room.people.slice(0, 14).map((person) => (
          <span key={person.id} title={person.name} className={`relative ${person.online ? "" : "opacity-35 grayscale"}`}>
            {person.emoji}{person.online && <span className="absolute -bottom-[0.1vw] -end-[0.1vw] h-[0.45vw] w-[0.45vw] rounded-full bg-emerald-400 ring-1 ring-slate-900" />}
          </span>
        ))}
        {room.people.length > 14 && <span className="text-[0.8vw] text-white/60">+{room.people.length - 14}</span>}
      </span>
      {!compact && <span className="mt-[0.3vw] text-[0.75vw] text-white/55">{copy(`${room.people.length} people · ${online} online`, `${room.people.length} أشخاص · ${online} متصلون`)}</span>}
      <span className="mt-[0.4vw] flex flex-wrap gap-x-[0.8vw] text-[0.9vw] font-semibold tabular-nums text-white/85">
        <span>💡 {room.cards.length}</span><span>💬 {room.comments}</span><span>👍 {room.reactions}</span>{!voting && room.votes > 0 && <span className="text-pink-300">● {room.votes}</span>}
      </span>
      {latest && !compact && (
        <span className="mt-auto block min-h-0 overflow-hidden pt-[0.4vw]">
          <span dir="auto" className="line-clamp-2 rounded-[0.6vw] bg-white/[0.08] px-[0.6vw] py-[0.3vw] text-[0.85vw] leading-snug text-white/90">
            {latest.author?.emoji} {latest.text || "📷"}
          </span>
          <span className="mt-[0.15vw] block text-end text-[0.65vw] text-white/40">{ago(latest.createdAt, now)}</span>
        </span>
      )}
    </button>
  );
}

/** One team, big: its people, every idea with its comments and replies, and help across teams. */
function RoomView({ room, state, pulse, copy, now, voting, onBack, onStep }: { room: Room; state: LiveState; pulse: LivePulse; copy: Copy; now: number; voting: boolean; onBack: () => void; onStep: (by: number) => void }) {
  const [person, setPerson] = useState<number | null>(null);
  useEffect(() => setPerson(null), [room.team]);
  const color = teamColor(room.team || null);
  const name = (id: number) => state.people.find((one) => one.id === id);
  const helpedBy = pulse.helps.filter((help) => help.to === room.team && !(voting && help.kind === "vote"));
  const helping = pulse.helps.filter((help) => help.from === room.team && !(voting && help.kind === "vote"));
  const allCards = state.cards.filter((card) => card.space !== "me" && !card.hidden);
  // Ideas from this team, plus other teams' ideas its people commented on.
  const cards = person === null ? room.cards : room.cards.filter((card) => card.author?.id === person || card.comments.some((comment) => comment.author?.id === person));
  const commentsBy = (id: number) => allCards.reduce((sum, card) => sum + card.comments.filter((comment) => comment.author?.id === id).length, 0);
  return (
    <section className="absolute inset-0 flex flex-col overflow-hidden rounded-[1.4vw] bg-slate-900/80 ring-1 ring-white/10" style={{ borderTop: `0.45vw solid ${color}` }} aria-label={teamName(room.team, copy)} data-room-view={room.team}>
      <header className="flex items-center gap-[1vw] px-[1.4vw] py-[0.9vw]">
        <button type="button" onClick={onBack} className="grid h-[2.6vw] w-[2.6vw] place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label={copy("All teams", "كل الفرق")}><ArrowLeft className="h-[1.3vw] w-[1.3vw] rtl:rotate-180" /></button>
        <h2 className="text-[2.2vw] font-black" style={{ color }}>{teamName(room.team, copy)}</h2>
        <StatusPill status={room.status} copy={copy} big />
        <span className="text-[1vw] text-white/60">{copy(`💡 ${room.cards.length} ideas · 💬 ${room.comments} comments · 👍 ${room.reactions}`, `💡 ${room.cards.length} فكرة · 💬 ${room.comments} تعليق · 👍 ${room.reactions}`)}</span>
        <span className="ms-auto flex gap-[0.4vw]">
          <button type="button" onClick={() => onStep(-1)} className="grid h-[2.6vw] w-[2.6vw] place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label={copy("Previous team", "الفريق السابق")}><ChevronLeft className="h-[1.3vw] w-[1.3vw] rtl:rotate-180" /></button>
          <button type="button" onClick={() => onStep(1)} className="grid h-[2.6vw] w-[2.6vw] place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label={copy("Next team", "الفريق التالي")}><ChevronRight className="h-[1.3vw] w-[1.3vw] rtl:rotate-180" /></button>
        </span>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[17vw_minmax(0,1fr)] gap-[1vw] px-[1.4vw] pb-[1.2vw]">
        <div className="min-h-0 space-y-[0.5vw] overflow-y-auto pe-[0.3vw]">
          <p className="text-[0.8vw] font-bold uppercase tracking-widest text-white/50"><Users className="me-[0.3vw] inline h-[0.9vw] w-[0.9vw]" />{copy("People", "الأشخاص")}</p>
          {room.people.map((member) => {
            const ideas = room.cards.filter((card) => card.author?.id === member.id).length;
            const helps = helping.filter((help) => help.personId === member.id).length;
            return (
              <button key={member.id} type="button" onClick={() => setPerson(person === member.id ? null : member.id)} aria-pressed={person === member.id} data-person={member.id}
                className={`flex w-full items-center gap-[0.6vw] rounded-[0.8vw] px-[0.6vw] py-[0.45vw] text-start transition ${person === member.id ? "bg-white text-slate-900" : "bg-white/[0.06] hover:bg-white/[0.12]"}`}>
                <span className="relative text-[1.6vw] leading-none">{member.emoji}{member.online && <span className="absolute -bottom-[0.1vw] -end-[0.1vw] h-[0.55vw] w-[0.55vw] rounded-full bg-emerald-400 ring-2 ring-slate-900" />}</span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[1vw] font-semibold">{member.name}</span>
                  <span className={`block text-[0.75vw] ${person === member.id ? "text-slate-600" : "text-white/55"}`}>💡 {ideas} · 💬 {commentsBy(member.id)}{helps > 0 && ` · 🤝 ${helps}`}</span>
                </span>
              </button>
            );
          })}
          {room.people.length === 0 && <p className="text-[0.9vw] text-white/50">{copy("Nobody in this team yet.", "لا أحد في هذا الفريق بعد.")}</p>}
          {(helpedBy.length > 0 || helping.length > 0) && (
            <div className="space-y-[0.3vw] pt-[0.6vw]">
              <p className="text-[0.8vw] font-bold uppercase tracking-widest text-white/50">🤝 {copy("Across teams", "بين الفرق")}</p>
              {helpedBy.slice(0, 4).map((help, i) => <p key={`in${i}`} className="text-[0.8vw] text-white/75">{name(help.personId)?.emoji} <span dir="auto">{name(help.personId)?.name}</span> <span style={{ color: teamColor(help.from) }}>({teamName(help.from, copy)})</span> {kindText(help.kind, copy)} {copy("here", "هنا")}</p>)}
              {helping.slice(0, 4).map((help, i) => <p key={`out${i}`} className="text-[0.8vw] text-white/75">{name(help.personId)?.emoji} <span dir="auto">{name(help.personId)?.name}</span> {kindText(help.kind, copy)} <span style={{ color: teamColor(help.to) }}>{teamName(help.to, copy)}</span></p>)}
            </div>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto">
          {cards.length === 0 ? <p className="mt-[6vw] text-center text-[1.5vw] text-white/50">{copy("No shared ideas yet. They're thinking…", "لا أفكار مشاركة بعد. يفكرون…")}</p> : (
            <div className="columns-2 gap-[0.9vw] xl:columns-3 [&>*]:mb-[0.9vw] [&>*]:break-inside-avoid">
              {cards.map((card) => (
                <article key={card.id} data-card={card.id} className={`rounded-[1vw] bg-white p-[0.9vw] text-slate-900 shadow-xl ${now - Date.parse(card.createdAt) < 30_000 ? "animate-[live-pop_0.6s_ease-out] ring-4 ring-sky-400" : ""}`}>
                  <p className="mb-[0.3vw] flex items-center gap-[0.4vw] text-[0.85vw] font-semibold text-slate-500">
                    <span className="text-[1.2vw]">{card.author?.emoji}</span><span dir="auto" className="truncate">{card.author?.name}</span>
                    <span className="ms-auto text-[0.7vw] font-normal">{card.space === "all" ? copy("everyone", "للجميع") : ""} {ago(card.createdAt, now)}</span>
                  </p>
                  {card.parentId && <p className="mb-[0.3vw] text-[0.75vw] text-sky-700">↳ {copy("builds on another idea", "تبني على فكرة أخرى")}</p>}
                  {card.text ? <p dir="auto" className="whitespace-pre-wrap text-[1.1vw] leading-snug">{card.text}</p> : <p className="text-[1.5vw]">📷</p>}
                  {(card.reactions.some((reaction) => reaction.count) || (!voting && (card.votes ?? 0) > 0)) && (
                    <p className="mt-[0.4vw] flex gap-[0.7vw] text-[0.9vw] text-slate-500">
                      {card.reactions.filter((reaction) => reaction.count).map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}
                      {!voting && (card.votes ?? 0) > 0 && <span className="font-bold text-pink-600">● {card.votes}</span>}
                    </p>
                  )}
                  {card.comments.length > 0 && (
                    <ul className="mt-[0.5vw] space-y-[0.3vw] border-t border-slate-200 pt-[0.4vw]">
                      {card.comments.slice(-4).map((comment) => {
                        const other = comment.author?.team && comment.author.team !== room.team && room.team !== 0;
                        return (
                          <li key={comment.id} className={`flex gap-[0.4vw] rounded-[0.5vw] text-[0.85vw] leading-snug ${other ? "bg-amber-50 px-[0.4vw] py-[0.2vw]" : ""} ${person !== null && comment.author?.id === person ? "font-semibold" : ""}`}>
                            <MessageCircle className="mt-[0.2vw] h-[0.8vw] w-[0.8vw] shrink-0 text-slate-400" />
                            <span className="min-w-0"><span className="font-semibold">{comment.author?.emoji} {comment.author?.name ?? copy("Instructor", "المدرّب")}</span>
                              {other && <span className="ms-[0.3vw] rounded-full px-[0.4vw] text-[0.7vw] text-white" style={{ background: teamColor(comment.author!.team) }}>🤝 {teamName(comment.author!.team!, copy)}</span>}
                              <span dir="auto" className="block text-slate-700">{comment.text}</span></span>
                          </li>
                        );
                      })}
                      {card.comments.length > 4 && <li className="text-[0.75vw] text-slate-400">+{card.comments.length - 4}</li>}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const kindText = (kind: string, copy: Copy) => ({
  comment: copy("commented on", "علّق على"), reaction: copy("reacted to", "تفاعل مع"), vote: copy("voted for", "صوّت لـ"), build: copy("built on", "بنى على"),
}[kind] ?? "");

/** What just happened, newest first. */
function Feed({ state, pulse, copy, now, voting, only }: { state: LiveState; pulse: LivePulse; copy: Copy; now: number; voting: boolean; only: number | null }) {
  const people = new Map(state.people.map((person) => [person.id, person]));
  const events = pulse.feed.filter((event) => only === null || only === 0 || event.team === only || event.toTeam === only).slice(0, 18);
  return (
    <>
      <p className="mb-[0.6vw] flex items-center gap-[0.5vw] text-[0.85vw] font-bold uppercase tracking-[0.25em] text-white/60">
        <span data-pulse-anim className="h-[0.55vw] w-[0.55vw] animate-[pulse-beat_1.6s_ease-in-out_infinite] rounded-full bg-emerald-400" />{only ? copy(`Live in ${teamName(only, copy)}`, `مباشر في ${teamName(only, copy)}`) : copy("Happening now", "يحدث الآن")}
      </p>
      {events.length === 0 ? <p className="m-auto text-center text-[1vw] text-white/50">{copy("Activity appears here as people join and share.", "يظهر النشاط هنا عندما ينضم الناس ويشاركون.")}</p> : (
        <ol className="min-h-0 flex-1 space-y-[0.45vw] overflow-hidden" data-testid="pulse-feed">
          {events.map((event) => {
            const person = event.personId ? people.get(event.personId) : null;
            const who = person ? <><span className="text-[1.1vw]">{person.emoji}</span> <b dir="auto">{person.name}</b></> : <b>{copy("Instructor", "المدرّب")}</b>;
            const team = event.team ? <span className="font-semibold" style={{ color: teamColor(event.team) }}>{teamName(event.team, copy)}</span> : null;
            const to = event.toTeam ? <span className="font-semibold" style={{ color: teamColor(event.toTeam) }}>{teamName(event.toTeam, copy)}</span> : null;
            const quote = event.text && event.kind !== "reaction" && event.kind !== "vote" ? <span dir="auto" className="mt-[0.15vw] line-clamp-2 block text-white/65">“{event.text}”</span> : null;
            let line: React.ReactNode;
            if (event.kind === "join") line = <>{who} {copy("joined", "انضم")}{team && <> {copy("·", "·")} {team}</>}</>;
            else if (event.kind === "idea") line = <>{who} {copy("shared an idea", "شارك فكرة")}{team && <> {copy("in", "في")} {team}</>}{quote}</>;
            else if (event.kind === "vote") line = <>{who} {copy("placed a dot", "وضع نقطة")}{!voting && to && <> {copy("on", "على")} {to}</>}</>;
            else if (to) line = <>🤝 {who} {team && <>({team}) </>}{kindText(event.kind, copy)} {copy("an idea of", "فكرة من")} {to}{event.kind === "reaction" && ` ${event.text}`}{quote}</>;
            else line = <>{who} {event.kind === "comment" ? copy("replied", "ردّ") : event.kind === "build" ? copy("built on an idea", "بنى على فكرة") : `${copy("reacted", "تفاعل")} ${event.text}`}{team && <> {copy("in", "في")} {team}</>}{quote}</>;
            return (
              <li key={`${event.at}-${event.kind}-${event.personId}-${event.cardId}`} data-pulse-anim className={`animate-[pulse-slide_0.5s_ease-out] rounded-[0.7vw] px-[0.7vw] py-[0.45vw] text-[0.9vw] leading-snug ${to && event.kind !== "vote" ? "bg-amber-300/15 ring-1 ring-amber-300/30" : "bg-white/[0.06]"}`}>
                <span className="float-end ms-[0.4vw] text-[0.7vw] text-white/40">{ago(event.at, now)}</span>{line}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** A line was clicked: who helped whom, or what two teams have in common. */
function SelectionPanel({ selection, state, pulse, voting, copy, onClose }: { selection: NonNullable<Selection>; state: LiveState; pulse: LivePulse; voting: boolean; copy: Copy; onClose: () => void }) {
  const people = new Map(state.people.map((person) => [person.id, person]));
  const cards = new Map(state.cards.map((card) => [card.id, card]));
  const { a, b } = selection;
  const title = <><span style={{ color: teamColor(a) }}>{teamName(a, copy)}</span> ⇄ <span style={{ color: teamColor(b) }}>{teamName(b, copy)}</span></>;
  const pair = pulse.similar.find((one) => one.a === a && one.b === b);
  const helps = pulse.helps.filter((help) => ((help.from === a && help.to === b) || (help.from === b && help.to === a)) && !(voting && help.kind === "vote"));
  const sample = (team: number) => state.cards.find((card) => card.space !== "me" && !card.hidden && (card.team ?? card.author?.team) === team && pair?.words.some((word) => card.text.toLowerCase().includes(word.slice(0, 4))));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pulse-selection">
      <div className="mb-[0.6vw] flex items-center gap-[0.5vw]">
        <p className="flex-1 text-[1.2vw] font-black">{title}</p>
        <button type="button" onClick={onClose} className="grid h-[2vw] w-[2vw] place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label={copy("Close", "إغلاق")}><X className="h-[1vw] w-[1vw]" /></button>
      </div>
      {selection.kind === "similar" && pair ? (
        <div className="space-y-[0.6vw] text-[0.95vw]">
          <p className="text-white/70">{copy("These teams are working on similar things. They could talk!", "هذان الفريقان يعملان على أشياء متشابهة. يمكنهما التحدث!")}</p>
          <p className="flex flex-wrap gap-[0.4vw]">{pair.words.map((word) => <span key={word} dir="auto" className="rounded-full bg-violet-500/30 px-[0.7vw] py-[0.15vw] font-semibold text-violet-100">{word}</span>)}</p>
          {[a, b].map((team) => { const card = sample(team); return card ? <p key={team} dir="auto" className="rounded-[0.7vw] bg-white/[0.07] p-[0.6vw] leading-snug" style={{ borderInlineStart: `0.3vw solid ${teamColor(team)}` }}>{card.author?.emoji} {card.text}</p> : null; })}
        </div>
      ) : (
        <ol className="min-h-0 flex-1 space-y-[0.45vw] overflow-y-auto">
          {helps.map((help, i) => {
            const person = people.get(help.personId);
            const card = cards.get(help.cardId);
            return (
              <li key={i} className="rounded-[0.7vw] bg-white/[0.06] px-[0.7vw] py-[0.45vw] text-[0.9vw] leading-snug">
                {person?.emoji} <b dir="auto">{person?.name}</b> <span style={{ color: teamColor(help.from) }}>({teamName(help.from, copy)})</span> {kindText(help.kind, copy)} <span style={{ color: teamColor(help.to) }}>{teamName(help.to, copy)}</span>
                {card?.text && <span dir="auto" className="mt-[0.15vw] line-clamp-2 block text-white/60">“{card.text}”</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
