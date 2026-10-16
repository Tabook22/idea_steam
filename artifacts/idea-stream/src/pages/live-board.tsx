import { useState } from "react";
import { useParams } from "wouter";
import { LayoutGrid, Loader2, Maximize, Megaphone, X } from "lucide-react";
import { LiveBoard } from "@/components/live-board";
import { LiveIdeaCard } from "@/components/live-card";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { LiveError, liveFetch, showCode, teamColor, useLiveState, type LiveCard } from "@/lib/live-api";
import { NOTE_COLORS, arrangeByTeam, type NoteColor } from "@/lib/live-board";

/**
 * The shared board, for the host and the projector: every team's notes pinned on one wall. The
 * host can move any note, tidy the board into team columns, light up one team, and open a note to
 * comment, recolour, hide or delete it.
 */
export default function LiveBoardPage() {
  const { id } = useParams<{ id: string }>();
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const { state, refresh } = useLiveState(`/api/live-admin/sessions/${id}/state`, 2000);
  const [open, setOpen] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const call = (path: string, method: string, json?: unknown) => liveFetch(`/api/live-admin${path}`, { method, ...(json !== undefined ? { json } : {}) });
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); await refresh(); } catch (failure) { toast({ variant: "destructive", title: failure instanceof LiveError ? failure.message : copy("It didn't work.", "لم ينجح.") }); }
  };
  if (!state) return <div className="fixed inset-0 z-[90] grid place-items-center bg-background"><Loader2 className="animate-spin" /></div>;
  const session = state.session;
  const cards = state.cards.filter((card) => card.space === "all");
  const teams = Array.from({ length: session.teamCount }, (_, i) => i + 1);
  const opened = cards.find((card) => card.id === open);
  const byId = new Map(state.cards.map((card) => [card.id, card]));

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="me-auto min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">{copy("The board", "اللوحة")} · <span dir="ltr">{showCode(session.code)}</span></p>
          <h1 dir="auto" className="truncate font-serif text-2xl leading-tight">{session.title}</h1>
        </div>
        <span className="text-sm text-muted-foreground">{copy(`${cards.length} notes`, `${cards.length} ملاحظة`)}</span>
        {teams.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label={copy("Light up a team", "أبرز فريقًا")}>
            {teams.map((team) => (
              <button key={team} type="button" onClick={() => setHighlight(highlight === team ? null : team)} aria-pressed={highlight === team}
                className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold ${highlight === team ? "text-white" : "bg-card"}`} style={highlight === team ? { background: teamColor(team), borderColor: teamColor(team) } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ background: highlight === team ? "#fff" : teamColor(team) }} />{copy(`Team ${team}`, `الفريق ${team}`)}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => void act(async () => {
          const spots = arrangeByTeam(cards.map((card) => ({ id: card.id, team: card.author?.team ?? card.team ?? 0, board: card.board })), session.teamCount);
          await call(`/sessions/${session.id}/board`, "POST", { positions: [...spots].map(([cardId, spot]) => ({ id: cardId, ...spot })) });
          toast({ title: copy("Tidied into team columns.", "رُتّبت في أعمدة الفرق.") });
        })} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-sm font-semibold hover:border-primary/40"><LayoutGrid size={15} />{copy("Arrange by team", "رتّب حسب الفرق")}</button>
        <button type="button" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} className="grid h-9 w-9 place-items-center rounded-full border bg-card" aria-label={copy("Full screen", "ملء الشاشة")}><Maximize size={15} /></button>
        <button type="button" onClick={() => { if (window.opener) window.close(); else history.back(); }} className="grid h-9 w-9 place-items-center rounded-full border bg-card" aria-label={copy("Close", "إغلاق")}><X size={16} /></button>
      </header>
      <div className="relative min-h-0 flex-1 p-3">
        <LiveBoard className="h-full" cards={cards} teamCount={session.teamCount} copy={copy} highlight={highlight}
          canMove={() => true} onOpen={(card) => setOpen(card.id)}
          onMove={(card, spot) => void act(() => call(`/cards/${card.id}`, "PATCH", spot))}
          toolbar={
            <form className="flex items-center" onSubmit={(event) => { event.preventDefault(); if (note.trim()) void act(async () => { await call(`/sessions/${session.id}/cards`, "POST", { text: note.trim() }); setNote(""); }); }}>
              <input dir="auto" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder={copy("A note to everyone…", "ملاحظة للجميع…")} aria-label={copy("A note to everyone", "ملاحظة للجميع")}
                className="h-9 w-44 rounded-full bg-secondary px-3 text-sm outline-none sm:w-64" />
              <button type="submit" disabled={!note.trim()} className="ms-1 inline-flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"><Megaphone size={14} />{copy("Pin", "ثبّت")}</button>
            </form>
          } />
        {opened && (
          <aside className="absolute inset-y-3 end-3 z-30 flex w-[min(26rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl" aria-label={copy("The note", "الملاحظة")}>
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <p className="me-auto font-semibold">{copy("The note", "الملاحظة")}</p>
              <div className="flex gap-1" role="group" aria-label={copy("Paper colour", "لون الورقة")}>
                {(Object.keys(NOTE_COLORS) as NoteColor[]).map((key) => (
                  <button key={key} type="button" onClick={() => void act(() => call(`/cards/${opened.id}`, "PATCH", { color: key }))} aria-pressed={(opened.color ?? "yellow") === key} aria-label={copy(NOTE_COLORS[key].en, NOTE_COLORS[key].ar)}
                    className={`h-6 w-6 rounded-full border-2 ${(opened.color ?? "yellow") === key ? "border-foreground" : "border-transparent"}`} style={{ background: NOTE_COLORS[key].band }} />
                ))}
              </div>
              <button type="button" onClick={() => setOpen(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary" aria-label={copy("Close", "إغلاق")}><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <LiveIdeaCard card={opened} parent={opened.parentId ? byId.get(opened.parentId) : undefined} copy={copy} instructor showTeam
                onComment={(text) => act(() => call(`/cards/${opened.id}/comments`, "POST", { text })).then(() => true)}
                onHide={(hidden) => void act(() => call(`/cards/${opened.id}`, "PATCH", { hidden }))}
                onDelete={() => { if (window.confirm(copy("Delete this note?", "حذف هذه الملاحظة؟"))) void act(async () => { await call(`/cards/${opened.id}`, "DELETE"); setOpen(null); }); }} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
