/**
 * Tunes the news desks without a pipeline run.
 *
 *   bun run scripts/news-dry-run.ts [YYYY-MM-DD] [--editor]
 *
 * Runs every enabled desk for real - it costs what a morning's desks cost - and prints each story
 * with its checks and its gate verdict, then what each desk searched for. Stores nothing. With
 * `--editor` it also writes the News section from the stories that passed, exactly as the report
 * would carry it, which costs one synthesis call more.
 *
 * It reads the database (the intel notes, the last days' reported stories, the context document),
 * so on a machine off the LAN it needs the tunnel from TODO.md's operational notes.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, notes } from "../src/db";
import { activePrompt } from "../src/ai/active-prompts";
import { synthesize } from "../src/ai/openai";
import { runNewsDesk, toExtraction } from "../src/news/desk";
import { NEWS_SOURCE_TYPE } from "../src/news/desks";
import { editorPayload, finishNewsSection, type NewsItem } from "../src/news/format";
import { decideGate, GATE_REASON_TEXT } from "../src/pipeline/gate";

const args = process.argv.slice(2);
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().split("T")[0];

const outcome = await runNewsDesk(date, { dryRun: true });

const passed: NewsItem[] = [];
for (const [index, { desk, story, validation }] of (outcome.preview ?? []).entries()) {
  const verdict = decideGate({
    sourceType: NEWS_SOURCE_TYPE,
    aiFailed: false,
    extractedJson: { validation },
    relevanceScore: story.significance,
    trustScore: 1,
    sourceCount: 1,
  });
  if (verdict.passed) passed.push({ id: `preview-${index}`, story: toExtraction(desk, story, validation) });

  const mark = verdict.passed ? "+" : "-";
  console.log(`\n${mark} [${desk} ${story.significance}] ${story.headline}`);
  if (!verdict.passed) console.log(`  held back: ${GATE_REASON_TEXT[verdict.reason]}`);
  console.log(`  ${story.summary}`);
  console.log(`  ${story.happened_at} | ${story.confidence} | ${story.region} | ${story.sources.map((s) => s.publisher).join(", ")}`);
}

for (const desk of outcome.desks) {
  console.log(`\n== ${desk.desk}: ${desk.status}, ${desk.stories} stories, ${desk.searchCalls} search calls${desk.error ? ` - ${desk.error}` : ""}`);
  for (const query of desk.queries ?? []) console.log(`   ${query}`);
}

console.log(
  `\nWindow ${outcome.window?.start} to ${outcome.window?.end}: ${passed.length} of ${outcome.preview?.length ?? 0} ` +
  `stories pass, ${outcome.searchCalls} search calls, ${outcome.tokensIn} tokens in, ${outcome.tokensOut} out`,
);

if (args.includes("--editor") && passed.length > 0) {
  const intel = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(eq(notes.scope, "intel"), isNull(notes.deletedAt)));
  const { payload, refs } = editorPayload(passed, outcome.home, intel.map((n) => n.content), date);
  const prompt = await activePrompt("news");
  const result = await synthesize(prompt.text, payload);
  console.log(`\n----- News section (${result.tokensIn} in, ${result.tokensOut} out) -----\n`);
  console.log(finishNewsSection(result.text, refs));
}

process.exit(0);
