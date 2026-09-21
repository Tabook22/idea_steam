export function recordingTitle(transcript: string, fallback: string) {
  const first = transcript.replace(/\s+/g, " ").trim();
  return first ? first.slice(0, 72) + (first.length > 72 ? "…" : "") : fallback;
}

/** Route only a leading explicit command with one exact notebook match. No fuzzy guessing. */
export function spokenSubject(
  transcript: string,
  subjects: Array<{ id: number; title: string }>,
): number | null {
  const command = transcript.match(
    /^\s*(?:save\s+(?:this\s+)?(?:under|to)|احفظ\s+(?:هذه\s+الفكرة\s+)?(?:في|تحت))\s+["“]?([^.!?؟\n"”]+)["”]?[.!?؟\n]/iu,
  );
  if (!command) return null;
  const normalize = (value: string) =>
    value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const matches = subjects.filter(
    (subject) => normalize(subject.title) === normalize(command[1]),
  );
  return matches.length === 1 ? matches[0].id : null;
}

export function retryDelay(attempts: number) {
  return Math.min(300_000, 5_000 * 2 ** Math.min(Math.max(0, attempts - 1), 6));
}
