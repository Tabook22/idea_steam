/**
 * Study packs: from a lecture recording, a notebook or a draft, the AI makes study notes, key
 * terms, a concept map, a quiz and flashcards. Everything is checked here: answers must point at
 * real options, choices are shuffled (so the answer isn't always "A"), and quotes must really be
 * in the source. Also: the flashcard schedule and the printable handouts.
 */
import type { QuizQuestion, StudyPackData, StudyPackOptions, StudyReviews } from "@workspace/db";
import { cleanSpec } from "./visuals";

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);
const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const loose = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const isArabic = (value: string) => (value.match(/[؀-ۿ]/g)?.length ?? 0) > (value.match(/[A-Za-z]/g)?.length ?? 0) / 2;

export function cleanOptions(raw: unknown): StudyPackOptions {
  const o = object(raw);
  const questions = Number(o.questions);
  return {
    questions: [5, 10, 15, 20].includes(questions) ? questions : 10,
    difficulty: o.difficulty === "easy" || o.difficulty === "hard" ? o.difficulty : "mixed",
    audience: o.audience === "kids" || o.audience === "adults" ? o.audience : "students",
    language: o.language === "ar" || o.language === "en" ? o.language : "auto",
  };
}

export function studyPrompt(options: StudyPackOptions, words: number) {
  const cards = Math.min(20, Math.max(6, Math.round(options.questions * 1.2)));
  const audience = { kids: "young learners (simple words, short sentences)", students: "school and university students", adults: "adult learners and professionals" }[options.audience];
  const difficulty = { easy: "mostly recall and basic understanding", mixed: "a mix: recall, understanding, and applying ideas", hard: "mostly understanding, applying and comparing; few pure recall questions" }[options.difficulty];
  const language = options.language === "ar" ? "Arabic" : options.language === "en" ? "English" : "the language the material is mostly in";
  return [
    "You are an experienced teacher. Turn the material below into a study pack that helps a learner understand and remember it.",
    `Audience: ${audience}. Write everything in ${language}, except quotes, which stay exactly as in the material.`,
    "Use ONLY what the material says. Do not add facts, dates or numbers that aren't in it.",
    "Return JSON with:",
    `- intro: 2-3 sentences: what this material is about and why it matters.`,
    `- sections: ${words < 600 ? "2-4" : "3-7"} study-note sections in the material's order, each {"heading": "...", "points": ["...", ...]} with 2-6 clear points (full sentences).`,
    "- terms: up to 10 key terms {\"term\": \"...\", \"meaning\": \"...\"} the learner must know.",
    "- concept: a concept map {\"center\": \"main idea\", \"branches\": [{\"label\": \"...\", \"items\": [\"...\"]}]} with 3-6 branches and up to 4 short items each.",
    `- quiz: exactly ${options.questions} questions, ${difficulty}. Mix types: about 60% "choice" (4 options), 20% "truefalse", 20% "short". Each {"type", "question", "options" (choice: 4 plausible options, only one right; truefalse: ["True","False"] in the pack's language; short: []), "answer" (index of the right option; -1 for short), "answerText" (the right answer in words; for short: a model answer in 1-2 sentences), "explanation" (why, in 1-2 sentences), "quote" (6-40 consecutive words copied exactly from the material that support the answer, or "")}.`,
    "  Wrong options must be believable (common misunderstandings), similar in length to the right one, never \"all of the above\". Cover the whole material, not just the start.",
    `- cards: ${cards} flashcards {"front": "a question or term", "back": "the short answer"}.`,
    "Answer with JSON only.",
  ].join("\n");
}

/** Shuffles choices (keeping track of the right one), so answers are spread across A-D. */
export function shuffleChoice(question: QuizQuestion, random: () => number = Math.random): QuizQuestion {
  if (question.type !== "choice") return question;
  const order = question.options.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...question, options: order.map((index) => question.options[index]), answer: order.indexOf(question.answer) };
}

function cleanQuestion(raw: unknown, haystack: string, language: "ar" | "en"): QuizQuestion | null {
  const q = object(raw);
  const question = text(q.question, 500);
  if (!question) return null;
  const type = q.type === "truefalse" || q.type === "short" ? q.type : "choice";
  const explanation = text(q.explanation, 800);
  const quote = text(q.quote, 400).replace(/^["“'«]+|["”'»]+$/g, "");
  const kept = loose(quote).split(" ").length >= 4 && haystack.includes(loose(quote)) ? quote : "";
  if (type === "short") {
    const answerText = text(q.answerText, 600);
    return answerText ? { type, question, options: [], answer: -1, answerText, explanation, quote: kept } : null;
  }
  if (type === "truefalse") {
    const answer = Number(q.answer);
    if (answer !== 0 && answer !== 1) return null;
    const options = language === "ar" ? ["صح", "خطأ"] : ["True", "False"];
    return { type, question, options, answer, answerText: options[answer]!, explanation, quote: kept };
  }
  const options = [...new Set(list(q.options, 6).map((option) => text(option, 300)).filter(Boolean))];
  const answer = Number(q.answer);
  if (options.length < 3 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return { type, question, options, answer, answerText: options[answer]!, explanation, quote: kept };
}

/** The AI's pack, checked. Null when there's nothing usable. */
export function cleanStudy(raw: unknown, source: string, options: StudyPackOptions, random: () => number = Math.random): StudyPackData | null {
  const data = object(raw);
  const haystack = loose(source);
  const sample = [text(data.intro, 600), ...list(data.sections, 2).map((s) => text(object(s).heading, 100))].join(" ");
  const language = options.language !== "auto" ? options.language : isArabic(sample || source) ? "ar" : "en";
  const sections = list(data.sections, 8).map((value) => {
    const section = object(value);
    return { heading: text(section.heading, 160), points: list(section.points, 8).map((point) => text(point, 600)).filter(Boolean) };
  }).filter((section) => section.heading && section.points.length);
  const terms = list(data.terms, 12).map((value) => ({ term: text(object(value).term, 100), meaning: text(object(value).meaning, 400) })).filter((term) => term.term && term.meaning);
  const quiz = list(data.quiz, 25).map((value) => cleanQuestion(value, haystack, language)).filter((q): q is QuizQuestion => !!q).slice(0, options.questions).map((q) => shuffleChoice(q, random));
  const cards = list(data.cards, 25).map((value) => ({ front: text(object(value).front, 300), back: text(object(value).back, 600) })).filter((card) => card.front && card.back);
  if (!sections.length && !quiz.length) return null;
  const concept = cleanSpec("concept", data.concept) as StudyPackData["concept"];
  return { intro: text(data.intro, 800), sections, terms, concept, quiz, cards, words: wordCount(source), language };
}

/** Flashcards: boxes 1-5 (Leitner). "again" goes back to box 1; "good" up one; "easy" up two. */
const DAYS = [0, 0, 1, 3, 7, 16];
export function reviewCard(reviews: StudyReviews, card: number, grade: "again" | "good" | "easy", now = new Date()): StudyReviews {
  const box = reviews[card]?.box ?? 1;
  const next = grade === "again" ? 1 : Math.min(5, box + (grade === "easy" ? 2 : 1));
  const due = new Date(now.getTime() + DAYS[next]! * 86_400_000);
  // "Again" comes back in the same sitting.
  if (grade === "again") due.setTime(now.getTime() + 60_000);
  return { ...reviews, [card]: { box: next, due: due.toISOString() } };
}
export const dueCards = (count: number, reviews: StudyReviews, now = new Date()) =>
  Array.from({ length: count }, (_, index) => index).filter((index) => !reviews[index] || Date.parse(reviews[index]!.due) <= now.getTime());

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A printable document: "notes" (handout), "quiz" (for learners, no answers) or "key" (answers). */
export function handoutHtml(title: string, pack: StudyPackData, kind: "notes" | "quiz" | "key", conceptPng?: string) {
  const ar = pack.language === "ar";
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  const letters = ar ? ["أ", "ب", "ج", "د", "هـ", "و"] : ["A", "B", "C", "D", "E", "F"];
  const parts: string[] = [];
  if (kind === "notes") {
    if (pack.intro) parts.push(`<p class="intro">${escape(pack.intro)}</p>`);
    if (conceptPng?.startsWith("data:image/png;base64,")) parts.push(`<figure><img src="${conceptPng}" alt=""></figure>`);
    for (const section of pack.sections) parts.push(`<h2>${escape(section.heading)}</h2><ul>${section.points.map((point) => `<li>${escape(point)}</li>`).join("")}</ul>`);
    if (pack.terms.length) parts.push(`<h2>${t("Key terms", "مصطلحات أساسية")}</h2><table>${pack.terms.map((term) => `<tr><th>${escape(term.term)}</th><td>${escape(term.meaning)}</td></tr>`).join("")}</table>`);
  } else {
    if (kind === "quiz") parts.push(`<p class="name">${t("Name", "الاسم")}: ______________________ &nbsp; ${t("Date", "التاريخ")}: ____________</p>`);
    parts.push("<ol class=\"quiz\">");
    pack.quiz.forEach((q) => {
      const options = q.type === "short" ? "" : `<ol class="options">${q.options.map((option, index) => `<li${kind === "key" && index === q.answer ? " class=\"right\"" : ""}><b>${letters[index]}</b> ${escape(option)}</li>`).join("")}</ol>`;
      const answer = kind === "key"
        ? `<p class="answer">✔ ${q.type === "short" ? escape(q.answerText) : `${letters[q.answer]}: ${escape(q.answerText)}`}${q.explanation ? `<br><span>${escape(q.explanation)}</span>` : ""}</p>`
        : q.type === "short" ? "<div class=\"lines\"></div>" : "";
      parts.push(`<li><p class="q">${escape(q.question)}</p>${options}${answer}</li>`);
    });
    parts.push("</ol>");
  }
  const heading = kind === "notes" ? t("Study notes", "ملخص الدرس") : kind === "quiz" ? t("Quiz", "اختبار") : t("Quiz: answer key", "الاختبار: الإجابات");
  return `<!doctype html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}">
<head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { color: #10231d; font: 15px/1.65 Arial, Tahoma, sans-serif; }
  header { border-bottom: 3px solid #1f5c4a; padding-bottom: 8px; margin-bottom: 18px; }
  header small { color: #1f5c4a; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 2px 0 0; }
  h2 { font-size: 18px; color: #1f5c4a; margin: 22px 0 6px; page-break-after: avoid; }
  .intro { font-size: 16px; background: #f1f6f3; border-radius: 10px; padding: 12px 14px; }
  figure { margin: 16px 0; text-align: center; } figure img { max-width: 100%; border: 1px solid #dde7e2; border-radius: 10px; }
  ul { padding-inline-start: 20px; } li { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #dde7e2; padding: 6px 8px; text-align: start; vertical-align: top; } th { width: 28%; color: #1f5c4a; }
  .name { margin-bottom: 18px; }
  ol.quiz > li { margin: 0 0 16px; page-break-inside: avoid; } .q { font-weight: bold; margin: 0 0 4px; }
  ol.options { list-style: none; padding: 0; margin: 0; } ol.options li { margin: 2px 0; padding: 3px 8px; border-radius: 6px; } ol.options b { display: inline-block; width: 22px; }
  ol.options li.right { background: #dcf3e6; font-weight: bold; }
  .answer { color: #145c3b; margin: 4px 0 0; } .answer span { color: #34514a; font-size: 13px; }
  .lines { height: 64px; background: repeating-linear-gradient(transparent 0 30px, #c9d6d0 30px 31px); }
</style></head>
<body><header><small>${heading}</small><h1>${escape(title)}</h1></header>${parts.join("\n")}</body></html>`;
}
