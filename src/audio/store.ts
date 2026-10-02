/**
 * The spoken report: the only writer of `report_audio`.
 *
 * The caller names a date and a chapter key; the text always comes from the stored report, never
 * from the request, so the endpoint can only ever pay to speak text the pipeline produced. A
 * chapter is spoken once per (text, model, voice, speed): a replay, a second device and a seek back all
 * read the cached row.
 */

import { and, eq, lt, ne, sql } from "drizzle-orm";
import { db, dailyReports, reportAudio } from "../db";
import { speak, TTS_MODEL, TTS_VOICE, TTS_SPEED } from "../ai/openai";
import { buildChapters, chunkText, estimateDurationMs, mp3DurationMs, type Chapter } from "./chapters";

/** One speech request takes at most 2000 tokens; German runs near 3 characters a token. */
const MAX_REQUEST_CHARS = 3500;
const KEEP_DAYS = 30;

const variant = () => `${TTS_MODEL}:${TTS_VOICE}:${TTS_SPEED}`;

export class AudioError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
  }
}

export interface ManifestChapter {
  key: string;
  section: string;
  title: string;
  words: number;
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
    .where(and(eq(reportAudio.reportDate, date), eq(reportAudio.variant, variant())));
  const cached = new Map(rows.map((row) => [row.key, row.durationMs]));

  return {
    voice: TTS_VOICE,
    chapters: chapters.map((chapter) => ({
      key: chapter.key,
      section: chapter.section,
      title: chapter.title,
      words: chapter.words,
      durationMs: cached.get(chapter.key) ?? estimateDurationMs(chapter.text),
      cached: cached.has(chapter.key),
    })),
  };
}

const inFlight = new Map<string, Promise<{ audio: Buffer; durationMs: number }>>();

async function generate(date: string, chapter: Chapter): Promise<{ audio: Buffer; durationMs: number }> {
  const parts: Buffer[] = [];
  for (const chunk of chunkText(chapter.text, MAX_REQUEST_CHARS)) parts.push(await speak(chunk));
  // MP3 frames are self-contained, so the pieces of a long chapter simply follow one another.
  const audio = Buffer.concat(parts);
  const durationMs = mp3DurationMs(audio);

  await db
    .insert(reportAudio)
    .values({ reportDate: date, chapterKey: chapter.key, variant: variant(), audio, durationMs, chars: chapter.text.length })
    .onConflictDoNothing();
  // Old days age out; the day just spoken stays, so replaying an archived report is still free.
  await db.delete(reportAudio).where(and(lt(reportAudio.reportDate, sql`(current_date - ${KEEP_DAYS}::int)`), ne(reportAudio.reportDate, date)));
  return { audio, durationMs };
}

export async function chapterAudio(date: string, key: string): Promise<{ audio: Buffer; durationMs: number }> {
  const [hit] = await db
    .select({ audio: reportAudio.audio, durationMs: reportAudio.durationMs })
    .from(reportAudio)
    .where(and(eq(reportAudio.reportDate, date), eq(reportAudio.chapterKey, key), eq(reportAudio.variant, variant())))
    .limit(1);
  if (hit) return { audio: Buffer.from(hit.audio), durationMs: hit.durationMs };

  const chapter = (await chaptersFor(date)).find((c) => c.key === key);
  if (!chapter) throw new AudioError("The report changed since the player loaded. Reload the page.", 409);

  // Two taps, or two devices, on the same uncached chapter share one paid request.
  const id = `${date}/${key}/${variant()}`;
  let pending = inFlight.get(id);
  if (!pending) {
    pending = generate(date, chapter).finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
  }
  return pending;
}
