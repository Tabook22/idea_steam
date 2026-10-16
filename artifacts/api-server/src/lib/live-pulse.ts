/**
 * Workshop Pulse: what the projector shows of a workshop at work. Who helps which team (comments,
 * reactions, votes and build-ons across teams), which teams have similar ideas, and a feed of what
 * just happened. Private ("Me") and hidden cards never count. Free of the database, for tests.
 */

export type PulseCard = { id: number; participantId: number | null; space: "me" | "team" | "all"; team: number | null; text: string; parentId: number | null; hidden: boolean; createdAt: Date; updatedAt?: Date };
export type PulsePerson = { id: number; name: string; emoji: string; team: number | null; createdAt: Date };
export type PulseComment = { id: number; cardId: number; participantId: number | null; text: string; createdAt: Date };
export type PulseReaction = { cardId: number; participantId: number; emoji: string; createdAt: Date };
export type PulseVote = { cardId: number; participantId: number; createdAt: Date };

export type HelpKind = "comment" | "reaction" | "vote" | "build";
export type Help = { from: number; to: number; personId: number; kind: HelpKind; cardId: number; at: string };
export type RoomLink = { a: number; b: number; count: number; people: number[]; kinds: Partial<Record<HelpKind, number>> };
export type SimilarRooms = { a: number; b: number; words: string[]; score: number };
export type PulseEvent = {
  at: string; kind: "idea" | HelpKind | "join"; team: number | null; personId: number | null;
  /** The team whose idea it was, when someone from another team helped. */
  toTeam: number | null; cardId: number | null; text: string;
};

/** Which team a card belongs to: its own team, else its author's (0: not in a team). */
export function roomOf(card: Pick<PulseCard, "team" | "participantId">, teamOf: Map<number, number | null>) {
  return card.team ?? (card.participantId !== null ? teamOf.get(card.participantId) ?? null : null) ?? 0;
}
const shown = (card: PulseCard | undefined): card is PulseCard => !!card && card.space !== "me" && !card.hidden;

/** Every time someone from one team worked on another team's idea. */
export function crossTeamHelps(people: PulsePerson[], cards: PulseCard[], comments: PulseComment[], reactions: PulseReaction[], votes: PulseVote[]): Help[] {
  const teamOf = new Map(people.map((person) => [person.id, person.team]));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const helps: Help[] = [];
  const add = (personId: number | null, cardId: number, kind: HelpKind, at: Date) => {
    const card = byId.get(cardId);
    if (personId === null || !shown(card)) return;
    const from = teamOf.get(personId) ?? null;
    const to = roomOf(card, teamOf);
    if (!from || !to || from === to || card.participantId === personId) return;
    helps.push({ from, to, personId, kind, cardId, at: at.toISOString() });
  };
  for (const comment of comments) add(comment.participantId, comment.cardId, "comment", comment.createdAt);
  for (const reaction of reactions) add(reaction.participantId, reaction.cardId, "reaction", reaction.createdAt);
  for (const vote of votes) add(vote.participantId, vote.cardId, "vote", vote.createdAt);
  // Building on another team's idea.
  for (const card of cards) if (shown(card) && card.parentId !== null) add(card.participantId, card.parentId, "build", card.createdAt);
  return helps;
}

/** The lines between teams: one per pair, strongest first. */
export function roomLinks(helps: Help[], limit = 12): RoomLink[] {
  const pairs = new Map<string, RoomLink & { who: Set<number> }>();
  for (const help of helps) {
    const [a, b] = help.from < help.to ? [help.from, help.to] : [help.to, help.from];
    const key = `${a}-${b}`;
    const link = pairs.get(key) ?? { a, b, count: 0, people: [], kinds: {}, who: new Set<number>() };
    link.count++;
    link.who.add(help.personId);
    link.kinds[help.kind] = (link.kinds[help.kind] ?? 0) + 1;
    pairs.set(key, link);
  }
  return [...pairs.values()].sort((x, y) => y.count - x.count || x.a - y.a || x.b - y.b).slice(0, limit)
    .map(({ who, ...link }) => ({ ...link, people: [...who] }));
}

const STOP = new Set(("a an the and or but if of to in on at by for with from as is are was were be been it its this that these those we you they i he she our your their my " +
  "not no yes can could should would will just so very more most also than then there here what which who how why when where all any some each about into over " +
  "do does did have has had make makes use using get idea ideas need needs like want one two new good better way ways thing things " +
  "في من على إلى الى عن مع هذا هذه ذلك تلك التي الذي الذين هو هي هم نحن أن ان إن لا ما لم لن كل بعض أو او ثم قد كان كانت يكون تكون عند بين حتى أي فكرة أفكار يمكن نحتاج").split(" "));

/** The meaningful words of a text (lower case, no small words; Arabic "ال" is dropped). */
export function keywords(text: string) {
  const words = text.toLowerCase().normalize("NFKC").replace(/[ً-ْـ]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let word of words) {
    if (/^[؀-ۿ]/.test(word)) { word = word.replace(/^(وال|بال|فال|كال|لل|ال)/, "").replace(/[ةه]$/, "ه").replace(/[أإآ]/g, "ا"); if (word.length < 3) continue; }
    else { if (word.length < 4) continue; word = word.replace(/(ies)$/, "y").replace(/(?<!s)s$/, ""); }
    if (!STOP.has(word) && !/^\d+$/.test(word)) out.add(word);
  }
  return out;
}

/** Teams working on the same things: the words their shared ideas have in common. */
export function similarRooms(people: PulsePerson[], cards: PulseCard[], limit = 6): SimilarRooms[] {
  const teamOf = new Map(people.map((person) => [person.id, person.team]));
  const words = new Map<number, Map<string, number>>();
  for (const card of cards) {
    if (!shown(card) || !card.text.trim()) continue;
    const room = roomOf(card, teamOf);
    if (!room) continue;
    const counts = words.get(room) ?? new Map<string, number>();
    for (const word of keywords(card.text)) counts.set(word, (counts.get(word) ?? 0) + 1);
    words.set(room, counts);
  }
  // Words every team uses (the workshop's own topic) say nothing about two teams being alike.
  const rooms = [...words.keys()].sort((a, b) => a - b);
  const spread = new Map<string, number>();
  for (const counts of words.values()) for (const word of counts.keys()) spread.set(word, (spread.get(word) ?? 0) + 1);
  const common = (word: string) => (spread.get(word) ?? 0) >= 3 && (spread.get(word) ?? 0) > rooms.length / 2;
  const pairs: SimilarRooms[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = words.get(rooms[i]!)!, b = words.get(rooms[j]!)!;
    const shared = [...a.keys()].filter((word) => b.has(word) && !common(word)).sort((x, y) => (b.get(y)! + a.get(y)!) - (b.get(x)! + a.get(x)!) || x.localeCompare(y));
    if (shared.length >= 2) pairs.push({ a: rooms[i]!, b: rooms[j]!, words: shared.slice(0, 4), score: shared.length });
  }
  return pairs.sort((x, y) => y.score - x.score || x.a - y.a).slice(0, limit);
}

/** What just happened, newest first: ideas, comments, reactions, votes, build-ons, people joining. */
export function pulseFeed(people: PulsePerson[], cards: PulseCard[], comments: PulseComment[], reactions: PulseReaction[], votes: PulseVote[], limit = 40): PulseEvent[] {
  const teamOf = new Map(people.map((person) => [person.id, person.team]));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const events: PulseEvent[] = [];
  const teamOfPerson = (id: number | null) => (id === null ? null : teamOf.get(id) ?? null);
  const onCard = (kind: HelpKind, personId: number | null, cardId: number, at: Date, text = "") => {
    const card = byId.get(cardId);
    if (!shown(card)) return;
    const team = teamOfPerson(personId);
    const to = roomOf(card, teamOf) || null;
    events.push({ at: at.toISOString(), kind, team, personId, toTeam: to !== team ? to : null, cardId, text: (text || card.text).slice(0, 140) });
  };
  for (const person of people) events.push({ at: person.createdAt.toISOString(), kind: "join", team: person.team, personId: person.id, toTeam: null, cardId: null, text: "" });
  for (const card of cards) {
    if (!shown(card)) continue;
    if (card.parentId !== null && shown(byId.get(card.parentId))) onCard("build", card.participantId, card.parentId, card.createdAt, card.text);
    else events.push({ kind: "idea", team: roomOf(card, teamOf) || null, personId: card.participantId, toTeam: null, cardId: card.id, text: card.text.slice(0, 140), at: (card.updatedAt ?? card.createdAt).toISOString() });
  }
  for (const comment of comments) onCard("comment", comment.participantId, comment.cardId, comment.createdAt, comment.text);
  for (const reaction of reactions) onCard("reaction", reaction.participantId || null, reaction.cardId, reaction.createdAt, reaction.emoji);
  for (const vote of votes) onCard("vote", vote.participantId, vote.cardId, vote.createdAt);
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** The last moment something happened in each team (to show which are active now). */
export function lastActivity(people: PulsePerson[], cards: PulseCard[], comments: PulseComment[], reactions: PulseReaction[], votes: PulseVote[]) {
  const teamOf = new Map(people.map((person) => [person.id, person.team]));
  const last: Record<number, string> = {};
  const touch = (team: number | null | undefined, at: Date) => {
    if (!team) return;
    const iso = at.toISOString();
    if (!last[team] || last[team]! < iso) last[team] = iso;
  };
  for (const card of cards) if (card.space !== "me" && !card.hidden) touch(roomOf(card, teamOf), card.updatedAt ?? card.createdAt);
  // Private writing still counts as being busy (only when, never what).
  for (const card of cards) if (card.space === "me" && card.participantId !== null) touch(teamOf.get(card.participantId), card.updatedAt ?? card.createdAt);
  for (const comment of comments) touch(comment.participantId === null ? null : teamOf.get(comment.participantId), comment.createdAt);
  for (const reaction of reactions) touch(teamOf.get(reaction.participantId), reaction.createdAt);
  for (const vote of votes) touch(teamOf.get(vote.participantId), vote.createdAt);
  return last;
}

/** Everything for the Pulse screen. */
export function buildPulse(people: PulsePerson[], cards: PulseCard[], comments: PulseComment[], reactions: PulseReaction[], votes: PulseVote[]) {
  const helps = crossTeamHelps(people, cards, comments, reactions, votes);
  return {
    links: roomLinks(helps),
    helps: helps.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200),
    similar: similarRooms(people, cards),
    feed: pulseFeed(people, cards, comments, reactions, votes),
    lastActivity: lastActivity(people, cards, comments, reactions, votes),
  };
}
