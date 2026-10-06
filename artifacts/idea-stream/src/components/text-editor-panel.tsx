import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play, Scissors, Search, Undo2, X } from "lucide-react";
import { formatTime, type Range } from "@/lib/audio-ranges";
import { isWordRemoved, rangesForWords, subtractRange, type TimedWord } from "@/lib/audio-cleanup";
import { findPhrase, paragraphs, shortenGap, spanBetween, spanIndexes, wordAt, wordGaps, type Span } from "@/lib/text-edit";

/**
 * Edit a recording like a document: select words (tap one, then tap another to select up to
 * it, or drag with a mouse), then cut or restore them; find a phrase and cut every place it is
 * said; shorten long pauses. The word being spoken lights up while it plays.
 */
export function TextEditorPanel({
  words, removed, cuts, duration, playing, originalPlayhead, fillers, copy,
  onCommit, onPlayOriginal, onPlayFrom, onStop, onSelectionChange,
}: {
  words: TimedWord[];
  removed: Range[];
  cuts: Range[];
  duration: number;
  playing: boolean;
  /** Where playback is, in original time. */
  originalPlayhead: number;
  fillers: Set<number>;
  copy: (en: string, ar: string) => string;
  onCommit: (next: Range[], message: string) => void;
  onPlayOriginal: (range: Range) => void;
  onPlayFrom: (originalTime: number) => void;
  onStop: () => void;
  /** The selected words' time (original), to show on the waveform. */
  onSelectionChange: (range: Range | null) => void;
}) {
  const [selected, setSelected] = useState<{ anchor: number; span: Span } | null>(null);
  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [matchAt, setMatchAt] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const mouse = useRef<{ down: boolean; anchor: number } | null>(null);
  const lastPointer = useRef<string>("");

  const isCut = useMemo(() => words.map((word) => isWordRemoved(word, removed)), [words, removed]);
  const blocks = useMemo(() => paragraphs(words), [words]);
  const matches = useMemo(() => (find.trim() ? findPhrase(words, find) : []), [words, find]);
  const matched = useMemo(() => {
    const set = new Set<number>();
    for (const span of matches) for (const index of spanIndexes(span)) set.add(index);
    return set;
  }, [matches]);
  const gaps = useMemo(() => {
    const map = new Map<number, { start: number; end: number }>();
    for (const gap of wordGaps(words, 1)) {
      const cut = shortenGap(gap);
      // Already shortened (or cut with the words around it): no chip.
      if (removed.some((r) => r.start <= cut.start + 0.05 && r.end >= cut.end - 0.05)) continue;
      map.set(gap.after, gap);
    }
    return map;
  }, [words, removed]);
  const spoken = playing ? wordAt(words, originalPlayhead) : -1;

  const choose = (next: { anchor: number; span: Span } | null) => {
    setSelected(next);
    onSelectionChange(next ? { start: words[next.span.from].start, end: words[next.span.to].end } : null);
  };
  useEffect(() => () => onSelectionChange(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // A tap selects a word; a second tap on another word selects everything between them.
  const tap = (index: number) => {
    if (selected && selected.span.from === selected.span.to) {
      if (selected.anchor === index) { choose(null); return; }
      choose({ anchor: selected.anchor, span: spanBetween(selected.anchor, index) });
      return;
    }
    choose({ anchor: index, span: { from: index, to: index } });
  };

  // Keep the spoken word in view while playing.
  useEffect(() => {
    if (spoken < 0 || !box.current) return;
    const element = box.current.querySelector<HTMLElement>(`[data-word="${spoken}"]`);
    if (!element) return;
    const top = element.offsetTop - box.current.offsetTop;
    if (top < box.current.scrollTop + 8 || top > box.current.scrollTop + box.current.clientHeight - 40)
      box.current.scrollTo({ top: Math.max(0, top - box.current.clientHeight / 3), behavior: "smooth" });
  }, [spoken]);

  const withCutNeighbours = (indexes: number[]) => {
    const set = new Set(indexes);
    for (const index of indexes) for (const n of [index - 1, index + 1]) if (isCut[n]) set.add(n);
    return [...set];
  };
  const count = (n: number) => copy(`${n} word${n === 1 ? "" : "s"}`, `${n} كلمة`);

  const span = selected?.span ?? null;
  const spanAllCut = !!span && spanIndexes(span).every((index) => isCut[index]);
  const spanSeconds = span ? words[span.to].end - words[span.from].start : 0;

  const cutSpan = () => {
    if (!span) return;
    const n = span.to - span.from + 1;
    onCommit([...removed, ...rangesForWords(words, withCutNeighbours(spanIndexes(span)))], copy(`Cut ${count(n)}`, `قُصّت ${count(n)}`));
    choose(null);
  };
  const restoreSpan = () => {
    if (!span) return;
    const n = span.to - span.from + 1;
    onCommit(subtractRange(cuts, { start: words[span.from - 1]?.end ?? 0, end: words[span.to + 1]?.start ?? duration }), copy(`Restored ${count(n)}`, `أُعيدت ${count(n)}`));
    choose(null);
  };
  const cutAllMatches = () => {
    const indexes = matches.flatMap((match) => spanIndexes(match)).filter((index) => !isCut[index]);
    if (!indexes.length) return;
    const places = matches.filter((match) => spanIndexes(match).some((index) => !isCut[index])).length;
    onCommit([...removed, ...rangesForWords(words, withCutNeighbours(indexes))],
      copy(`Cut “${find.trim()}” in ${places} place${places === 1 ? "" : "s"}`, `قُصّت «${find.trim()}» في ${places} موضع`));
    choose(null);
  };
  const nextMatch = () => {
    if (!matches.length) return;
    const next = (matchAt + 1) % matches.length;
    setMatchAt(next);
    choose({ anchor: matches[next].from, span: matches[next] });
    box.current?.querySelector(`[data-word="${matches[next].from}"]`)?.scrollIntoView({ block: "nearest" });
  };

  // Delete/Backspace cuts (or restores) the selected words; Escape clears the selection.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !selected) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopImmediatePropagation(); if (spanAllCut) restoreSpan(); else cutSpan(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); choose(null); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const unusedMatches = matches.filter((match) => spanIndexes(match).some((index) => !isCut[index])).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-white/55">
          {copy("Tap a word, then tap another to select everything between. Cut it and the audio is cut with it.",
            "انقر كلمة ثم انقر أخرى لتحديد ما بينهما. اقطعها فيُقطع الصوت معها.")}
        </p>
        <button type="button" onClick={() => setFindOpen((open) => !open)} aria-expanded={findOpen}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${findOpen ? "bg-emerald-500 text-[#06150e]" : "bg-white/10 text-white hover:bg-white/15"}`}>
          <Search size={13} />{copy("Find & cut", "ابحث واقطع")}
        </button>
      </div>

      {findOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.06] p-2">
          <input value={find} onChange={(event) => { setFind(event.target.value); setMatchAt(-1); }} dir="auto" autoFocus
            placeholder={copy("A word or phrase, e.g. “you know”", "كلمة أو عبارة، مثل «يعني»")}
            aria-label={copy("Find words", "ابحث عن كلمات")}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/60" />
          <span className="text-xs tabular-nums text-white/60" role="status">
            {find.trim() ? copy(`${matches.length} found`, `${matches.length} نتيجة`) : ""}
          </span>
          <button type="button" onClick={nextMatch} disabled={!matches.length}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-40">
            <ChevronDown size={13} />{copy("Next", "التالي")}
          </button>
          <button type="button" onClick={cutAllMatches} disabled={!unusedMatches}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-red-500/90 px-3 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40">
            <Scissors size={13} />{copy(`Cut all (${unusedMatches})`, `اقطع الكل (${unusedMatches})`)}
          </button>
        </div>
      )}

      <div ref={box} dir="auto" className="relative mt-2 max-h-[42vh] min-h-24 overflow-y-auto rounded-xl bg-black/20 px-3 py-2 text-[15px] leading-9 select-none"
        onPointerUp={() => { if (mouse.current) mouse.current.down = false; }} onPointerLeave={() => { if (mouse.current) mouse.current.down = false; }}>
        {blocks.map((block) => (
          <p key={block.from} className="mb-2">
            <button type="button" onClick={() => onPlayFrom(block.start)} title={copy("Play from here", "شغّل من هنا")}
              className="me-2 inline-flex h-6 -translate-y-px items-center gap-1 rounded-md bg-white/[0.07] px-1.5 align-middle font-mono text-[11px] tabular-nums text-white/55 hover:bg-emerald-500/20 hover:text-emerald-200">
              <Play size={10} />{formatTime(block.start)}
            </button>
            {spanIndexes(block).map((index) => {
              const word = words[index];
              const cut = isCut[index];
              const chosen = !!span && index >= span.from && index <= span.to;
              const gap = gaps.get(index);
              return (
                <span key={index}>
                  <button type="button" data-word={index} aria-pressed={chosen}
                    title={`${formatTime(word.start, true)}${cut ? ` · ${copy("cut", "مقطوعة")}` : ""}`}
                    onPointerDown={(event) => {
                      lastPointer.current = event.pointerType;
                      if (event.pointerType !== "mouse" || event.button !== 0) return;
                      event.preventDefault();
                      const anchor = event.shiftKey && selected ? selected.anchor : index;
                      mouse.current = { down: true, anchor };
                      choose({ anchor, span: spanBetween(anchor, index) });
                    }}
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse" && mouse.current?.down && event.buttons === 1)
                        choose({ anchor: mouse.current.anchor, span: spanBetween(mouse.current.anchor, index) });
                    }}
                    onClick={(event) => { if (lastPointer.current === "mouse" && event.detail > 0) return; tap(index); }}
                    className={[
                      "me-1 rounded px-0.5 transition-colors",
                      chosen ? "bg-sky-500/45 text-white" : spoken === index ? "bg-emerald-400/30 text-white" : matched.has(index) ? "bg-amber-400/25" : "hover:bg-white/10",
                      cut ? "text-red-300/70 line-through decoration-2" : "",
                      fillers.has(index) && !cut ? "underline decoration-amber-400 decoration-wavy underline-offset-4" : "",
                    ].join(" ")}>
                    {word.word.trim()}
                  </button>
                  {gap && (
                    <button type="button" onClick={() => onCommit([...removed, shortenGap(gap)], copy("Pause shortened", "قُصّرت الوقفة"))}
                      title={copy("A long pause: tap to shorten it", "وقفة طويلة: انقر لتقصيرها")}
                      className="me-1 inline-flex h-6 -translate-y-px items-center rounded-full border border-dashed border-white/25 px-1.5 align-middle font-mono text-[10px] text-white/50 hover:border-amber-300/70 hover:text-amber-200">
                      ⏸ {(gap.end - gap.start).toFixed(1)}s
                    </button>
                  )}
                </span>
              );
            })}
          </p>
        ))}
      </div>

      {span && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 p-2" role="toolbar" aria-label={copy("Selected words", "الكلمات المحددة")}>
          <span className="min-w-0 flex-1 text-xs text-sky-100">
            <span className="font-semibold">{count(span.to - span.from + 1)}</span> · {spanSeconds.toFixed(1)} s
            {span.from === span.to && <span className="ms-1.5 text-sky-100/60">{copy("· tap another word to select up to it", "· انقر كلمة أخرى للتحديد حتى هناك")}</span>}
          </span>
          <button type="button" onClick={() => (playing ? onStop() : onPlayOriginal({ start: words[span.from].start, end: words[span.to].end }))}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15">
            {playing ? <Pause size={13} /> : <Play size={13} />}{copy("Listen", "استمع")}
          </button>
          {spanAllCut ? (
            <button type="button" onClick={restoreSpan} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 px-3 text-xs font-semibold text-[#06150e] hover:bg-emerald-400">
              <Undo2 size={13} />{copy("Restore", "استعادة")}
            </button>
          ) : (
            <button type="button" onClick={cutSpan} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-red-500/90 px-3 text-xs font-semibold text-white hover:bg-red-500">
              <Scissors size={13} />{copy("Cut", "قص")}
            </button>
          )}
          <button type="button" onClick={() => choose(null)} aria-label={copy("Clear selection", "إلغاء التحديد")}
            className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
