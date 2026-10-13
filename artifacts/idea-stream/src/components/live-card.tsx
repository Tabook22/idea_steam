import { useState } from "react";
import { CornerDownRight, EyeOff, Globe2, Lock, Megaphone, MessageCircle, MoreHorizontal, Send, Trash2, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { appPath } from "@/lib/app-path";
import { teamColor, type LiveCard as Card, type LiveSpace } from "@/lib/live-api";

type Copy = (en: string, ar: string) => string;

function ago(iso: string, copy: Copy) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return copy("now", "الآن");
  if (minutes < 60) return copy(`${minutes} min`, `${minutes} د`);
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * An idea card in a workshop: who wrote it, the idea (text, photo or voice), what it builds on,
 * reactions and comments. Its author can share it further or delete it; the instructor can hide it.
 */
export function LiveIdeaCard({ card, parent, copy, readOnly, showTeam, instructor, voting, onVote, onReact, onComment, onDeleteComment, onBuild, onShare, onDelete, onHide }: {
  card: Card; parent?: Card; copy: Copy; readOnly?: boolean; showTeam?: boolean; instructor?: boolean;
  /** Voting is open (a dot button on others' ideas). */
  voting?: boolean;
  onVote?: () => void;
  onReact?: (emoji: string) => void;
  onComment: (text: string) => Promise<boolean>;
  onDeleteComment?: (id: number) => void;
  onBuild?: () => void;
  onShare?: (space: LiveSpace) => void;
  onDelete?: () => void;
  onHide?: (hidden: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const fromInstructor = card.author === null;
  const media = card.media ? appPath(card.media.url, import.meta.env.BASE_URL) : null;
  const spaces: Array<[LiveSpace, typeof Lock, string]> = [
    ["me", Lock, copy("Only me", "لي فقط")], ["team", Users, copy("My team", "فريقي")], ["all", Globe2, copy("Everyone", "الجميع")],
  ];
  return (
    <article className={`rounded-3xl border bg-card p-4 shadow-sm transition ${card.hidden ? "opacity-60" : ""} ${fromInstructor ? "border-amber-300 bg-gradient-to-br from-amber-50 to-card dark:border-amber-800 dark:from-amber-950/30" : ""}`}>
      <header className="mb-2 flex items-center gap-2.5">
        {fromInstructor ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><Megaphone size={17} /></span>
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl" style={{ background: `${teamColor(card.author?.team ?? null)}1f` }}>{card.author?.emoji}</span>
        )}
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-sm font-semibold">{fromInstructor ? copy("From the instructor", "من المدرّب") : card.author?.name}{card.mine && <span className="ms-1.5 text-xs font-normal text-muted-foreground">{copy("(you)", "(أنت)")}</span>}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {ago(card.createdAt, copy)}
            {showTeam && card.author?.team && <span className="rounded-full px-1.5 py-px font-semibold text-white" style={{ background: teamColor(card.author.team) }}>{copy(`Team ${card.author.team}`, `الفريق ${card.author.team}`)}</span>}
            {card.mine && card.space === "me" && <span className="inline-flex items-center gap-0.5"><Lock size={10} />{copy("private", "خاص")}</span>}
            {card.hidden && <span className="inline-flex items-center gap-0.5 font-medium text-amber-700"><EyeOff size={10} />{copy("hidden by the instructor", "أخفاها المدرّب")}</span>}
          </p>
        </div>
        {(card.mine && !readOnly) || (instructor && !fromInstructor) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary" aria-label={copy("More", "المزيد")}><MoreHorizontal size={17} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {card.mine && onShare && spaces.filter(([space]) => space !== card.space).map(([space, Icon, label]) => (
                <DropdownMenuItem key={space} onSelect={() => onShare(space)}><Icon size={15} className="me-2" />{copy("Move to: ", "انقل إلى: ")}{label}</DropdownMenuItem>
              ))}
              {instructor && onHide && <DropdownMenuItem onSelect={() => onHide(!card.hidden)}><EyeOff size={15} className="me-2" />{card.hidden ? copy("Show it again", "أظهرها مجددًا") : copy("Hide from participants", "أخفِها عن المشاركين")}</DropdownMenuItem>}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 size={15} className="me-2" />{copy("Delete", "حذف")}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      {parent && (
        <p dir="auto" className="mb-2 flex gap-1.5 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <CornerDownRight size={13} className="mt-0.5 shrink-0 rtl:-scale-x-100" />
          <span className="line-clamp-2">{copy("Builds on", "يبني على")} {parent.author?.name ?? copy("the instructor", "المدرّب")}: “{parent.text || copy("a photo", "صورة")}”</span>
        </p>
      )}
      {card.text && <p dir="auto" className={`whitespace-pre-wrap text-start leading-7 ${fromInstructor ? "font-serif text-lg" : "text-[15px]"}`}>{card.text}</p>}
      {media && card.media?.type.startsWith("image/") && (
        <a href={media} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-2xl border bg-muted/30">
          <img src={media} alt={card.text || copy("Photo", "صورة")} loading="lazy" className="max-h-96 w-full object-contain" />
        </a>
      )}
      {media && card.media && !card.media.type.startsWith("image/") && <audio src={media} controls preload="none" className="mt-2 h-10 w-full" />}

      {voting && !card.mine && !fromInstructor && onVote && (
        <button type="button" onClick={onVote} aria-pressed={card.myVote}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 py-2.5 text-sm font-bold transition active:scale-[0.98] ${card.myVote ? "border-pink-600 bg-pink-600 text-white shadow-md" : "border-dashed border-pink-300 text-pink-700 hover:bg-pink-50 dark:text-pink-300 dark:hover:bg-pink-950/30"}`}>
          <span className={`h-4 w-4 rounded-full ${card.myVote ? "bg-white" : "border-2 border-current"}`} />
          {card.myVote ? copy("Your dot is here (tap to take it back)", "نقطتك هنا (اضغط لاسترجاعها)") : copy("Put a dot on this idea", "ضع نقطة على هذه الفكرة")}
        </button>
      )}
      <footer className="mt-3 flex flex-wrap items-center gap-1.5">
        {card.votes !== null && card.votes > 0 && (
          <span className="inline-flex h-8 items-center gap-1 rounded-full bg-pink-100 px-2.5 text-sm font-bold text-pink-800 dark:bg-pink-950/40 dark:text-pink-200" title={copy("Votes", "أصوات")}>
            {"●".repeat(Math.min(card.votes, 5))}{card.votes > 5 ? "+" : ""} {card.votes}
          </span>
        )}
        {card.reactions.map((reaction) => (
          <button key={reaction.emoji} type="button" disabled={readOnly || !onReact} onClick={() => onReact?.(reaction.emoji)} aria-pressed={reaction.mine}
            className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-sm transition active:scale-95 ${reaction.mine ? "border-primary/50 bg-primary/10 font-semibold" : "bg-background hover:bg-secondary"}`}>
            <span>{reaction.emoji}</span>{reaction.count > 0 && <span className="text-xs">{reaction.count}</span>}
          </button>
        ))}
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm text-muted-foreground hover:bg-secondary">
          <MessageCircle size={15} />{card.comments.length > 0 ? card.comments.length : copy("Comment", "علّق")}
        </button>
        {onBuild && !readOnly && (
          <button type="button" onClick={onBuild} className="ms-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-primary hover:bg-primary/10">
            <CornerDownRight size={15} className="rtl:-scale-x-100" />{copy("Build on this", "ابنِ عليها")}
          </button>
        )}
      </footer>

      {open && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {card.comments.map((one) => (
            <div key={one.id} className="flex items-start gap-2">
              <span className="text-base leading-6">{one.author?.emoji ?? "📣"}</span>
              <p dir="auto" className="min-w-0 flex-1 rounded-2xl bg-muted/60 px-3 py-1.5 text-sm">
                <span className="me-1.5 font-semibold">{one.author?.name ?? copy("Instructor", "المدرّب")}</span>{one.text}
              </p>
              {one.mine && onDeleteComment && <button type="button" onClick={() => onDeleteComment(one.id)} className="mt-1 text-muted-foreground hover:text-destructive" aria-label={copy("Delete comment", "احذف التعليق")}><Trash2 size={13} /></button>}
            </div>
          ))}
          {!readOnly && (
            <form className="flex gap-2" onSubmit={async (event) => { event.preventDefault(); if (comment.trim() && await onComment(comment.trim())) setComment(""); }}>
              <input dir="auto" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} placeholder={copy("Write a comment…", "اكتب تعليقًا…")}
                aria-label={copy("Write a comment", "اكتب تعليقًا")} className="h-10 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm outline-none focus:border-primary" />
              <button type="submit" disabled={!comment.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40" aria-label={copy("Send", "أرسل")}><Send size={16} className="rtl:-scale-x-100" /></button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
