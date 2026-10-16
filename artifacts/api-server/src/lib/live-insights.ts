/**
 * Team insights for the host: every team compared, and each member's contribution. Two separate
 * measures, never blended: effort (what someone did) and impact (how others responded to their
 * ideas). Private ideas count only as a number, never their words. Free of the database.
 */
import type { PulseCard, PulseComment, PulsePerson, PulseReaction, PulseVote } from "./live-pulse";

/** Points for effort and impact: shown to the host, so the scores are never a mystery. */
export const EFFORT_POINTS = { idea: 3, build: 3, comment: 2, privateIdea: 1, reaction: 1, vote: 1 } as const;
export const IMPACT_POINTS = { voteReceived: 2, buildReceived: 2, commentReceived: 1, reactionReceived: 1 } as const;

export type MemberStats = {
  id: number; team: number | null;
  ideas: number; builds: number; privateIdeas: number; comments: number; reactions: number; votes: number;
  /** Things others did with this person's ideas. */
  votesReceived: number; reactionsReceived: number; commentsReceived: number; buildsReceived: number;
  /** Comments, reactions, votes and build-ons on other teams' ideas. */
  helpsOtherTeams: number;
  effort: number; impact: number; firstAt: string | null; lastAt: string | null;
};
export type TeamStats = {
  team: number; members: number[]; activeMembers: number; participation: number;
  ideas: number; builds: number; privateIdeas: number; comments: number; reactions: number; votes: number;
  votesReceived: number; helpsGiven: number; helpsReceived: number;
  effort: number; impact: number; effortPerPerson: number; impactPerPerson: number;
  /** 1: everyone contributed equally; 0: one person did everything. */
  evenness: number;
  topCardId: number | null;
  timeline: number[];
};

const shown = (card: PulseCard | undefined): card is PulseCard => !!card && card.space !== "me" && !card.hidden;
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** How evenly a team's effort is shared (1 - normalised share of the biggest contributor above fair). */
export function evenness(efforts: number[]) {
  const total = efforts.reduce((sum, n) => sum + n, 0);
  if (efforts.length < 2 || total === 0) return 1;
  const fair = 1 / efforts.length;
  const top = Math.max(...efforts) / total;
  return round(1 - (top - fair) / (1 - fair));
}

/** Activity over time: the number of things done in each slice (12 slices from start to now). */
export function timeline(times: Date[], start: Date, end: Date, slices = 12) {
  const counts = new Array<number>(slices).fill(0);
  const span = Math.max(1, end.getTime() - start.getTime());
  for (const at of times) {
    const index = Math.floor(((at.getTime() - start.getTime()) / span) * slices);
    if (index >= 0) counts[Math.min(slices - 1, index)]!++;
  }
  return counts;
}

export function buildInsights(people: PulsePerson[], cards: PulseCard[], comments: PulseComment[], reactions: PulseReaction[], votes: PulseVote[], teamCount: number, now = new Date()) {
  const teamOf = new Map(people.map((person) => [person.id, person.team]));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const roomOf = (card: PulseCard) => card.team ?? (card.participantId !== null ? teamOf.get(card.participantId) ?? null : null);
  const members = new Map<number, MemberStats & { times: Date[] }>(people.map((person) => [person.id, {
    id: person.id, team: person.team, ideas: 0, builds: 0, privateIdeas: 0, comments: 0, reactions: 0, votes: 0,
    votesReceived: 0, reactionsReceived: 0, commentsReceived: 0, buildsReceived: 0, helpsOtherTeams: 0, effort: 0, impact: 0, firstAt: null, lastAt: null, times: [],
  }]));
  const did = (personId: number | null, at: Date) => { const m = personId === null ? undefined : members.get(personId); if (m) m.times.push(at); return m; };
  const helped = (personId: number | null, card: PulseCard) => {
    const m = personId === null ? undefined : members.get(personId);
    const from = m?.team ?? null, to = roomOf(card);
    if (m && from && to && from !== to && card.participantId !== personId) m.helpsOtherTeams++;
  };
  const authorOf = (card: PulseCard | undefined) => (card?.participantId != null ? members.get(card.participantId) : undefined);

  for (const card of cards) {
    if (card.space === "me") { const m = did(card.participantId, card.createdAt); if (m) m.privateIdeas++; continue; }
    if (card.hidden) continue;
    const m = did(card.participantId, card.updatedAt ?? card.createdAt);
    const parent = card.parentId !== null ? byId.get(card.parentId) : undefined;
    if (shown(parent)) {
      if (m) { m.builds++; helped(card.participantId, parent); }
      const author = authorOf(parent);
      if (author && m && author.id !== m.id) author.buildsReceived++;
    } else if (m) m.ideas++;
  }
  for (const comment of comments) {
    const card = byId.get(comment.cardId);
    if (!shown(card)) continue;
    const m = did(comment.participantId, comment.createdAt);
    if (m) { m.comments++; helped(comment.participantId, card); }
    const author = authorOf(card);
    if (author && comment.participantId !== null && members.has(comment.participantId) && author.id !== comment.participantId) author.commentsReceived++;
  }
  for (const reaction of reactions) {
    const card = byId.get(reaction.cardId);
    if (!shown(card)) continue;
    const m = did(reaction.participantId || null, reaction.createdAt);
    if (m) { m.reactions++; helped(reaction.participantId, card); }
    const author = authorOf(card);
    if (author && reaction.participantId !== null && members.has(reaction.participantId) && author.id !== reaction.participantId) author.reactionsReceived++;
  }
  for (const vote of votes) {
    const card = byId.get(vote.cardId);
    if (!shown(card)) continue;
    const m = did(vote.participantId, vote.createdAt);
    if (m) { m.votes++; helped(vote.participantId, card); }
    const author = authorOf(card);
    if (author && vote.participantId !== null && members.has(vote.participantId) && author.id !== vote.participantId) author.votesReceived++;
  }

  const allTimes = [...members.values()].flatMap((m) => m.times);
  const start = allTimes.length ? new Date(Math.min(...allTimes.map((t) => t.getTime()), ...people.map((p) => p.createdAt.getTime()))) : now;
  const memberList: MemberStats[] = [...members.values()].map(({ times, ...m }) => {
    const sorted = times.map((t) => t.getTime()).sort((a, b) => a - b);
    return {
      ...m,
      effort: m.ideas * EFFORT_POINTS.idea + m.builds * EFFORT_POINTS.build + m.comments * EFFORT_POINTS.comment + m.privateIdeas * EFFORT_POINTS.privateIdea + m.reactions * EFFORT_POINTS.reaction + m.votes * EFFORT_POINTS.vote,
      impact: m.votesReceived * IMPACT_POINTS.voteReceived + m.buildsReceived * IMPACT_POINTS.buildReceived + m.commentsReceived * IMPACT_POINTS.commentReceived + m.reactionsReceived * IMPACT_POINTS.reactionReceived,
      firstAt: sorted.length ? new Date(sorted[0]!).toISOString() : null,
      lastAt: sorted.length ? new Date(sorted.at(-1)!).toISOString() : null,
    };
  });

  const teams: TeamStats[] = Array.from({ length: teamCount }, (_, i) => i + 1).map((team) => {
    const list = memberList.filter((m) => m.team === team);
    const sum = (key: keyof MemberStats) => list.reduce((total, m) => total + (m[key] as number), 0);
    const teamCards = cards.filter((card) => shown(card) && roomOf(card) === team);
    const voteCount = (id: number) => votes.filter((vote) => vote.cardId === id).length;
    const top = teamCards.filter((card) => voteCount(card.id) > 0).sort((a, b) => voteCount(b.id) - voteCount(a.id) || a.id - b.id)[0];
    const helpsReceived = countHelpsInto(team);
    const active = list.filter((m) => m.effort > 0).length;
    return {
      team, members: list.map((m) => m.id), activeMembers: active, participation: list.length ? round(active / list.length) : 0,
      ideas: sum("ideas"), builds: sum("builds"), privateIdeas: sum("privateIdeas"), comments: sum("comments"), reactions: sum("reactions"), votes: sum("votes"),
      votesReceived: sum("votesReceived"), helpsGiven: sum("helpsOtherTeams"), helpsReceived,
      effort: sum("effort"), impact: sum("impact"),
      effortPerPerson: list.length ? round(sum("effort") / list.length, 1) : 0, impactPerPerson: list.length ? round(sum("impact") / list.length, 1) : 0,
      evenness: evenness(list.map((m) => m.effort)), topCardId: top?.id ?? null,
      timeline: timeline(list.flatMap((m) => members.get(m.id)!.times), start, now),
    };
  });

  function countHelpsInto(team: number) {
    let count = 0;
    const from = (personId: number | null) => (personId === null ? null : teamOf.get(personId) ?? null);
    const into = (personId: number | null, card: PulseCard | undefined) => {
      if (!shown(card) || roomOf(card) !== team) return;
      const t = from(personId);
      if (t && t !== team && card.participantId !== personId) count++;
    };
    for (const card of cards) if (shown(card) && card.parentId !== null) into(card.participantId, byId.get(card.parentId));
    for (const comment of comments) into(comment.participantId, byId.get(comment.cardId));
    for (const reaction of reactions) into(reaction.participantId, byId.get(reaction.cardId));
    for (const vote of votes) into(vote.participantId, byId.get(vote.cardId));
    return count;
  }

  return { members: memberList, teams, start: start.toISOString(), now: now.toISOString(), timeline: timeline(allTimes, start, now), effortPoints: EFFORT_POINTS, impactPoints: IMPACT_POINTS };
}
