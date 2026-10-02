import { Router, type IRouter } from "express";
import { count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db, ideasTable, subjectCompilationsTable, subjectsTable } from "@workspace/db";
import { SearchWorkspaceQueryParams } from "@workspace/api-zod";
import {
  ARABIC_FROM,
  ARABIC_MARKS,
  ARABIC_TO,
  leadingSnippet,
  likePattern,
  normalizeForSearch,
  snippetAround,
} from "../lib/search-text";

const router: IRouter = Router();

/** SQL twin of normalizeForSearch, applied after removing markup. */
const normalized = (value: SQL) =>
  sql`regexp_replace(translate(regexp_replace(lower(regexp_replace(${value}, '<[^>]+>', ' ', 'g')), ${ARABIC_MARKS}, '', 'g'), ${ARABIC_FROM}, ${ARABIC_TO}), '\\s+', ' ', 'g')`;

router.get("/search", async (req, res): Promise<void> => {
  const parsed = SearchWorkspaceQueryParams.safeParse(req.query);
  const query = parsed.success ? parsed.data.q.trim() : "";
  const needle = normalizeForSearch(query);
  if (needle.length < 2) {
    res.status(400).json({ error: "Type at least two characters to search." });
    return;
  }
  const pattern = likePattern(needle);
  const matches = (value: SQL) => sql`${normalized(value)} ilike ${pattern} escape '\\'`;
  try {
    const [ideaRows, subjectRows, draftRows] = await Promise.all([
      db
        .select({ idea: ideasTable, subjectTitle: subjectsTable.title })
        .from(ideasTable)
        .innerJoin(subjectsTable, eq(ideasTable.subjectId, subjectsTable.id))
        .where(sql`${matches(sql`${ideasTable.content}`)} or exists (
          select 1 from jsonb_array_elements(${ideasTable.attachments}) as item
          where ${matches(sql`concat_ws(' ', item->>'transcript', item->>'note', item->>'extractedText', item->>'name')`)}
        )`)
        .orderBy(desc(ideasTable.createdAt))
        .limit(40),
      db
        .select({ subject: subjectsTable, ideaCount: count(ideasTable.id) })
        .from(subjectsTable)
        .leftJoin(ideasTable, eq(ideasTable.subjectId, subjectsTable.id))
        .where(matches(sql`concat_ws(' ', ${subjectsTable.title}, ${subjectsTable.intro})`))
        .groupBy(subjectsTable.id)
        .orderBy(desc(subjectsTable.updatedAt))
        .limit(10),
      db
        .select({ draft: subjectCompilationsTable, subjectTitle: subjectsTable.title })
        .from(subjectCompilationsTable)
        .innerJoin(subjectsTable, eq(subjectCompilationsTable.subjectId, subjectsTable.id))
        .where(matches(sql`${subjectCompilationsTable.content}`))
        .orderBy(desc(subjectCompilationsTable.updatedAt))
        .limit(10),
    ]);

    const ideas = ideaRows.map(({ idea, subjectTitle }) => {
      let matchedIn: "content" | "transcript" | "note" | "attachment" = "content";
      let snippet = snippetAround(idea.content, query);
      for (const item of idea.attachments) {
        if (snippet) break;
        for (const [field, kind] of [["transcript", "transcript"], ["note", "note"], ["extractedText", "attachment"], ["name", "attachment"]] as const) {
          const text = item[field];
          const found = text ? snippetAround(text, query) : null;
          if (found) { snippet = found; matchedIn = kind; break; }
        }
      }
      return {
        id: idea.id,
        subjectId: idea.subjectId,
        subjectTitle,
        source: idea.source,
        snippet: snippet ?? leadingSnippet(idea.content),
        matchedIn,
        createdAt: idea.createdAt.toISOString(),
      };
    });
    res.json({
      query,
      ideas,
      subjects: subjectRows.map(({ subject, ideaCount }) => ({
        id: subject.id,
        title: subject.title,
        snippet: snippetAround(subject.intro, query) ?? leadingSnippet(subject.intro, 120),
        ideaCount: Number(ideaCount),
      })),
      drafts: draftRows.map(({ draft, subjectTitle }) => ({
        id: draft.id,
        subjectId: draft.subjectId,
        subjectTitle,
        tone: draft.tone,
        snippet: snippetAround(draft.content, query) ?? leadingSnippet(draft.content),
        updatedAt: draft.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    req.log?.error({ err: error }, "Search failed");
    res.status(500).json({ error: "Search is unavailable right now. Please try again." });
  }
});

export default router;
