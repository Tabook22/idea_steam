import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Globe2, LayoutGrid, Loader2, Maximize, QrCode as QrIcon, Users, X } from "lucide-react";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { joinLink, showCode, teamColor, useLiveState } from "@/lib/live-api";
import { QrCode } from "@/pages/live-sessions";

type Mode = "join" | "wall" | "teams";

/**
 * The projector: a big QR code and code with people popping in as they join, then the live wall
 * of ideas shared with everyone, and the teams at work.
 */
export default function LivePresentPage() {
  const { id } = useParams<{ id: string }>();
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { state } = useLiveState(`/api/live-admin/sessions/${id}/state`, 2000);
  const [mode, setMode] = useState<Mode>("join");
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "1") setMode("join");
      if (event.key === "2") setMode("wall");
      if (event.key === "3") setMode("teams");
      if (event.key.toLowerCase() === "f") void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  if (!state) return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950 text-white"><Loader2 className="animate-spin" /></div>;
  const session = state.session;
  const link = joinLink(session.code);
  const people = state.people;
  const wall = state.cards.filter((card) => card.space === "all" && !card.hidden).sort((a, b) => b.id - a.id).slice(0, 30);
  const teams = Array.from({ length: session.teamCount }, (_, index) => index + 1);

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-[radial-gradient(ellipse_at_top_left,#1e3a5f_0%,#0b1220_55%,#05080f_100%)] text-white">
      {mode === "join" && (
        <div className="grid h-full grid-cols-1 items-center gap-[4vw] p-[4vw] md:grid-cols-[auto_1fr]">
          <div className="mx-auto rounded-[2rem] bg-white p-[1.2vw] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
            <QrCode text={link} className="block h-[min(62vh,40vw)] w-[min(62vh,40vw)]" />
          </div>
          <div className="min-w-0">
            <p className="text-[1.6vw] font-medium uppercase tracking-[0.3em] text-sky-300">{copy("Join now", "انضم الآن")}</p>
            <p className="mt-[0.5vw] font-mono text-[8vw] font-black leading-none tracking-wider" dir="ltr">{showCode(session.code)}</p>
            <p className="mt-[1vw] text-[1.5vw] text-white/70" dir="ltr">{link.replace(/^https?:\/\//, "").replace(/\/join\/.*/, "/join")}</p>
            <h1 dir="auto" className="mt-[2.5vw] font-serif text-[3vw] leading-tight text-white">{session.title}</h1>
            {session.challenge && <p dir="auto" className="mt-[0.8vw] line-clamp-3 max-w-[50vw] text-[1.6vw] leading-snug text-white/80">{session.challenge}</p>}
            <div className="mt-[2.5vw] flex items-baseline gap-[1vw]">
              <span className="text-[5vw] font-black tabular-nums leading-none">{people.length}</span>
              <span className="text-[1.6vw] text-white/70">{copy(people.length === 1 ? "person joined" : "people joined", "انضموا")}</span>
            </div>
            <div className="mt-[1vw] flex max-h-[22vh] flex-wrap gap-[0.6vw] overflow-hidden">
              {[...people].reverse().slice(0, 60).map((person) => (
                <span key={person.id} className="inline-flex animate-[live-pop_0.5s_ease-out] items-center gap-[0.4vw] rounded-full bg-white/10 px-[0.9vw] py-[0.35vw] text-[1.2vw] backdrop-blur">
                  <span>{person.emoji}</span><span dir="auto" className="max-w-[14vw] truncate">{person.name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "wall" && (
        <div className="flex h-full flex-col p-[2.5vw]">
          <div className="mb-[1.5vw] flex items-end justify-between gap-[2vw]">
            <div className="min-w-0">
              <p className="text-[1.1vw] font-semibold uppercase tracking-[0.25em] text-sky-300">{copy("Shared with everyone", "مشاركة مع الجميع")}</p>
              <h1 dir="auto" className="truncate font-serif text-[2.6vw] text-white">{session.challenge || session.title}</h1>
            </div>
            <p className="shrink-0 font-mono text-[1.6vw] text-white/70" dir="ltr">{showCode(session.code)}</p>
          </div>
          {wall.length === 0 ? (
            <p className="m-auto text-[2vw] text-white/60">{copy("Ideas shared with everyone appear here.", "تظهر هنا الأفكار المشاركة مع الجميع.")}</p>
          ) : (
            <div className="min-h-0 flex-1 columns-3 gap-[1.2vw] overflow-hidden [&>*]:mb-[1.2vw] [&>*]:break-inside-avoid">
              {wall.map((card, index) => (
                <article key={card.id} className={`rounded-[1.4vw] bg-white p-[1.2vw] text-slate-900 shadow-xl ${index === 0 ? "animate-[live-pop_0.6s_ease-out] ring-4 ring-sky-400" : ""}`}
                  style={{ borderTop: `0.4vw solid ${card.author ? teamColor(card.author.team) : "#f59e0b"}` }}>
                  <p className="mb-[0.5vw] flex items-center gap-[0.5vw] text-[1vw] font-semibold text-slate-500">
                    <span className="text-[1.5vw]">{card.author?.emoji ?? "📣"}</span><span dir="auto" className="truncate">{card.author?.name ?? copy("Instructor", "المدرّب")}</span>
                    {card.author?.team && <span className="ms-auto rounded-full px-[0.6vw] text-[0.85vw] text-white" style={{ background: teamColor(card.author.team) }}>{copy(`Team ${card.author.team}`, `الفريق ${card.author.team}`)}</span>}
                  </p>
                  {card.media?.type.startsWith("image/") && <img src={appPath(card.media.url, import.meta.env.BASE_URL)} alt="" className="mb-[0.6vw] max-h-[28vh] w-full rounded-[0.8vw] object-cover" />}
                  {card.text && <p dir="auto" className="whitespace-pre-wrap text-[1.45vw] leading-snug">{card.text}</p>}
                  {card.reactions.some((reaction) => reaction.count) && (
                    <p className="mt-[0.6vw] flex gap-[0.8vw] text-[1.1vw] text-slate-500">{card.reactions.filter((reaction) => reaction.count).map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "teams" && (
        <div className="flex h-full flex-col p-[2.5vw]">
          <h1 className="mb-[1.5vw] font-serif text-[2.6vw] text-white">{copy("Teams at work", "الفرق تعمل")}</h1>
          {teams.length === 0 ? (
            <p className="m-auto text-[2vw] text-white/60">{copy("No teams yet.", "لا فرق بعد.")}</p>
          ) : (
            <div className="grid min-h-0 flex-1 auto-rows-fr gap-[1.2vw]" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.ceil(Math.sqrt(teams.length)) + 1)}, minmax(0, 1fr))` }}>
              {teams.map((team) => {
                const members = people.filter((person) => person.team === team);
                const ideas = state.cards.filter((card) => card.space === "team" && card.team === team && !card.hidden).sort((a, b) => b.id - a.id);
                return (
                  <div key={team} className="flex min-h-0 flex-col overflow-hidden rounded-[1.4vw] bg-white/[0.07] p-[1.2vw] backdrop-blur" style={{ borderTop: `0.4vw solid ${teamColor(team)}` }}>
                    <div className="flex items-baseline justify-between">
                      <p className="text-[1.6vw] font-bold" style={{ color: teamColor(team) }}>{copy(`Team ${team}`, `الفريق ${team}`)}</p>
                      <p className="text-[1.1vw] text-white/70">{copy(`${ideas.length} ideas`, `${ideas.length} فكرة`)}</p>
                    </div>
                    <p className="mt-[0.4vw] text-[1.5vw] tracking-wide">{members.map((person) => person.emoji).join(" ")}</p>
                    <div className="mt-[0.6vw] min-h-0 space-y-[0.5vw] overflow-hidden">
                      {ideas.slice(0, 3).map((card) => <p key={card.id} dir="auto" className="line-clamp-2 rounded-[0.7vw] bg-white/10 px-[0.8vw] py-[0.4vw] text-[1.1vw] leading-snug">{card.text || "📷"}</p>)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Controls: shown on hover (keys 1, 2, 3 and F work too). */}
      <div className="group fixed bottom-0 end-0 p-4">
        <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 opacity-30 backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {([["join", QrIcon, copy("Join", "انضمام")], ["wall", Globe2, copy("Wall", "الحائط")], ["teams", LayoutGrid, copy("Teams", "الفرق")]] as const).map(([value, Icon, label]) => (
            <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value}
              className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${mode === value ? "bg-white text-slate-900" : "text-white"}`}><Icon size={16} />{label}</button>
          ))}
          <span className="mx-1 inline-flex items-center gap-1 px-2 text-sm text-white/80"><Users size={15} />{people.length}</span>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10" aria-label={copy("Full screen", "ملء الشاشة")}><Maximize size={16} /></button>
          <button type="button" onClick={() => { if (window.opener) window.close(); else history.back(); }} className="grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10" aria-label={copy("Close", "إغلاق")}><X size={16} /></button>
        </div>
      </div>
    </div>
  );
}
