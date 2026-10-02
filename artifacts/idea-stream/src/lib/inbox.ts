import { createSubject, type Subject } from "@workspace/api-client-react";

export const INBOX_TITLES = ["Idea inbox", "صندوق الأفكار"];

export const isInbox = (subject: Pick<Subject, "title">) => INBOX_TITLES.includes(subject.title);

/** The inbox notebook's id, creating it on first use. */
export async function ensureInboxId(subjects: Subject[], arabic: boolean) {
  const existing = subjects.find(isInbox);
  if (existing) return existing.id;
  const created = await createSubject({
    title: arabic ? "صندوق الأفكار" : "Idea inbox",
    intro: arabic ? "سجّل الآن ونظّم لاحقًا." : "Capture now. Organize later.",
  });
  return created.id;
}

/** Subjects you can file into, most recently active first. */
export const fileableSubjects = (subjects: Subject[]) =>
  [...subjects].filter((subject) => !isInbox(subject)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
