/**
 * Recordings mixed before background music became a removable layer were saved as copies named
 * "<title> · with music" with the music baked in. Their voice can still be recovered from the
 * recording they were made from: same transcript, or the title the copy was named after.
 */

type Candidate = {
  id: number;
  title: string | null;
  transcript: string | null;
  kind: string;
  createdAt: Date;
  mix: unknown;
};

export const LEGACY_SUFFIX = /\s·\s(with music|مع موسيقى)$/;

/** How the app names a recording that has no title: the start of its transcript. */
export const snippet = (transcript: string | null) => {
  const words = transcript?.replace(/\s+/g, " ").trim();
  return words ? (words.length > 70 ? `${words.slice(0, 70).trim()}…` : words) : null;
};

/** The recording an old "· with music" copy was made from, if it can be found. */
export function findLegacySource<T extends Candidate>(item: T, all: T[]): T | null {
  if (item.mix || item.kind !== "recording" || !item.title || !LEGACY_SUFFIX.test(item.title)) return null;
  const base = item.title.replace(LEGACY_SUFFIX, "").trim();
  const matches = all.filter((other) =>
    other.id !== item.id
    && other.kind === "recording"
    && !(other.title && LEGACY_SUFFIX.test(other.title))
    && other.createdAt.getTime() <= item.createdAt.getTime()
    && ((item.transcript && other.transcript === item.transcript) || other.title === base || (!other.title && snippet(other.transcript) === base)));
  // The most recent one made before the copy.
  return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}
