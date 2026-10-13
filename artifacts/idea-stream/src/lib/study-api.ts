import { liveFetch } from "@/lib/live-api";

/** Study packs: what the server sends, and the calls. */
export type StudyKind = "recording" | "subject" | "draft";
export type StudyOptions = { questions: number; difficulty: "easy" | "mixed" | "hard"; audience: "kids" | "students" | "adults"; language: "auto" | "ar" | "en" };
export type QuizQuestion = { type: "choice" | "truefalse" | "short"; question: string; options: string[]; answer: number; answerText: string; explanation: string; quote: string };
export type StudyData = {
  intro: string;
  sections: Array<{ heading: string; points: string[] }>;
  terms: Array<{ term: string; meaning: string }>;
  concept: { center: string; branches: Array<{ label: string; items: string[] }> } | null;
  quiz: QuizQuestion[];
  cards: Array<{ front: string; back: string }>;
  words: number;
  language: "ar" | "en";
};
export type StudyReviews = Record<string, { box: number; due: string }>;
export type StudySummary = {
  id: number; sourceKind: StudyKind; sourceId: number; title: string; options: StudyOptions; status: "making" | "ready" | "failed"; error: string | null;
  questionCount: number; cardCount: number; dueCount: number; createdAt: string;
};
export type StudyPack = StudySummary & { data: StudyData | null; reviews: StudyReviews };

export const listPacks = (source?: { kind: StudyKind; id: number }) =>
  liveFetch<StudySummary[]>(`/api/study/packs${source ? `?sourceKind=${source.kind}&sourceId=${source.id}` : ""}`);
export const getPack = (id: number) => liveFetch<StudyPack>(`/api/study/packs/${id}`);
export const makePack = (kind: StudyKind, sourceId: number, options: StudyOptions) =>
  liveFetch<StudyPack>("/api/study/packs", { method: "POST", json: { sourceKind: kind, sourceId, options } });
export const remakePack = (id: number, options?: StudyOptions) => liveFetch<StudyPack>(`/api/study/packs/${id}/remake`, { method: "POST", json: options ? { options } : {} });
export const reviewCard = (id: number, card: number, grade: "again" | "good" | "easy") =>
  liveFetch<{ reviews: StudyReviews; dueCount: number }>(`/api/study/packs/${id}/review`, { method: "POST", json: { card, grade } });
export const resetReviews = (id: number) => liveFetch<{ reviews: StudyReviews }>(`/api/study/packs/${id}/reviews/reset`, { method: "POST", json: {} });
export const deletePack = (id: number) => liveFetch<void>(`/api/study/packs/${id}`, { method: "DELETE" });

/**
 * Cards to review in this sitting: never seen first, then due ones by when they're due. A card you
 * missed ("again") is due in a minute, so it goes to the back and comes round again.
 */
export const dueCards = (count: number, reviews: StudyReviews, now = Date.now(), soon = 10 * 60_000) =>
  Array.from({ length: count }, (_, index) => index)
    .filter((index) => !reviews[index] || Date.parse(reviews[index]!.due) <= now + soon)
    .sort((a, b) => (reviews[a] ? Date.parse(reviews[a]!.due) : -1) - (reviews[b] ? Date.parse(reviews[b]!.due) : -1) || a - b);
