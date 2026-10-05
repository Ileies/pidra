/**
 * The spoken report: the only writer of `report_audio`. Served by `src/server/routes/audio.ts`;
 * chapters come from `daily_reports.report_json` via `chapters.ts`. The `variant` column is
 * `<model>:<voice>` (`VARIANT` below), so changing either re-speaks.
 *
 * The caller names a date and a chapter key; the text always comes from the stored report, never
 * from the request, so the endpoint can only ever pay to speak text the pipeline produced. A
 * chapter is spoken once per (text, model, voice): a replay, a second device and a seek back all
 * read the cached row. The estimated cost of each first-time chapter is added to
 * `pipeline_runs.audio_cost_usd` of the date's newest run.
 */

import { HttpError } from "../util/errors";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { db, dailyReports, pipelineRuns, reportAudio } from "../db";
import { speechCostUsd } from "./cost";
import { speak, TTS_MODEL, TTS_VOICE } from "../ai/openai";
import { buildChapters, chunkText, estimateDurationMs, mp3DurationMs, type Chapter, type Segment } from "./chapters";

/** One speech request takes at most 2000 tokens; German runs near 3 characters a token. */
const MAX_REQUEST_CHARS = 3500;
const KEEP_DAYS = 30;

/** Speech requests in flight at once for one chapter: first-play latency without a burst on the flex tier. */
const SPEAK_CONCURRENCY = 3;

const VARIANT = `${TTS_MODEL}:${TTS_VOICE}`;

export class AudioError extends HttpError {}

export interface ManifestChapter {
  key: string;
  section: string;
  title: string;
  words: number;
  segments: Segment[];
  /** Exact once the chapter has been spoken, an estimate before. */
  durationMs: number;
  cached: boolean;
}

async function chaptersFor(date: string): Promise<Chapter[]> {
  const [row] = await db.select({ reportJson: dailyReports.reportJson }).from(dailyReports).where(eq(dailyReports.reportDate, date)).limit(1);
  if (!row) throw new AudioError("There is no report for this day.", 404);
  return row.reportJson ? buildChapters(row.reportJson) : [];
}

export async function audioManifest(date: string): Promise<{ voice: string; chapters: ManifestChapter[] }> {
  const chapters = await chaptersFor(date);
  const rows = await db
    .select({ key: reportAudio.chapterKey, durationMs: reportAudio.durationMs })
    .from(reportAudio)
    .where(and(eq(reportAudio.reportDate, date), eq(reportAudio.variant, VARIANT)));
  const cached = new Map(rows.map((row) => [row.key, row.durationMs]));

  return {
    voice: TTS_VOICE,
    chapters: chapters.map((chapter) => ({
      key: chapter.key,
      section: chapter.section,
      title: chapter.title,
      words: chapter.words,
      segments: chapter.segments,
      durationMs: cached.get(chapter.key) ?? estimateDurationMs(chapter.text),
      cached: cached.has(chapter.key),
    })),
  };
}

/** Adds to the newest run of the date, the one the report came from. A date with no run row (an old report) has nowhere to book it. */
async function addAudioCost(date: string, usd: number): Promise<void> {
  const [latest] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.runDate, date))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  if (!latest) return;
  await db.update(pipelineRuns).set({ audioCostUsd: sql`${pipelineRuns.audioCostUsd} + ${usd}` }).where(eq(pipelineRuns.id, latest.id));
}

const inFlight = new Map<string, Promise<{ audio: Buffer; durationMs: number }>>();

async function generate(date: string, chapter: Chapter): Promise<{ audio: Buffer; durationMs: number }> {
  const chunks = chunkText(chapter.text, MAX_REQUEST_CHARS);
  const parts: Buffer[] = [];
  for (let start = 0; start < chunks.length; start += SPEAK_CONCURRENCY) {
    parts.push(...await Promise.all(chunks.slice(start, start + SPEAK_CONCURRENCY).map((chunk) => speak(chunk))));
  }
  // MP3 frames are self-contained, so the pieces of a long chapter simply follow one another.
  const audio = Buffer.concat(parts);
  const durationMs = mp3DurationMs(audio);

  const inserted = await db
    .insert(reportAudio)
    .values({ reportDate: date, chapterKey: chapter.key, variant: VARIANT, audio, durationMs, chars: chapter.text.length })
    .onConflictDoNothing()
    .returning({ chapterKey: reportAudio.chapterKey });
  // Only the request that stored the row is billed to the run; a lost race was a duplicate spend, not a second chapter.
  if (inserted.length > 0) await addAudioCost(date, speechCostUsd(chapter.text.length, durationMs));
  // Old days age out; the day just spoken stays, so replaying an archived report is still free.
  await db.delete(reportAudio).where(and(lt(reportAudio.reportDate, sql`(current_date - ${KEEP_DAYS}::int)`), ne(reportAudio.reportDate, date)));
  return { audio, durationMs };
}

export async function chapterAudio(date: string, key: string): Promise<{ audio: Buffer; durationMs: number }> {
  const [hit] = await db
    .select({ audio: reportAudio.audio, durationMs: reportAudio.durationMs })
    .from(reportAudio)
    .where(and(eq(reportAudio.reportDate, date), eq(reportAudio.chapterKey, key), eq(reportAudio.variant, VARIANT)))
    .limit(1);
  if (hit) return { audio: Buffer.from(hit.audio), durationMs: hit.durationMs };

  const chapter = (await chaptersFor(date)).find((c) => c.key === key);
  if (!chapter) throw new AudioError("The report changed since the player loaded. Reload the page.", 409);

  // Two taps, or two devices, on the same uncached chapter share one paid request.
  const id = `${date}/${key}/${VARIANT}`;
  let pending = inFlight.get(id);
  if (!pending) {
    pending = generate(date, chapter).finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }
  return pending;
}
