/**
 * The report as something to listen to: pure text work, no I/O.
 *
 * A report becomes a list of chapters, one per group the page already shows (an urgency level, a
 * news group, a briefing domain), each carrying the exact text a voice will read. Markdown is
 * written for eyes, so links, refs comments and bare URLs are removed before speaking; reading a
 * URL aloud is the worst thing a briefing can do.
 *
 * `key` hashes the spoken text. It is the cache key and the chapter's identity on the wire, so a
 * report that changed since the player loaded is detected rather than played as the wrong text.
 */

import { createHash } from "node:crypto";
import type { ReportJson, ReportEntry, Urgency } from "../pipeline/report-json";

export interface Chapter {
  index: number;
  key: string;
  /** The `##` section the chapter belongs to. */
  section: string;
  /** The group heading. */
  title: string;
  /** Exactly what is sent to the voice, headings included. */
  text: string;
  words: number;
}

const URGENCY_TITLE: Record<Urgency, string> = {
  critical: "Critical",
  high: "High priority",
  normal: "Normal",
  mentions: "Mentions",
};

const SECTION_PERSONAL = "Personal Action Center";
const SECTION_NEWS = "News";
const SECTION_INTEL = "Intelligence Briefing";
const SECTION_ALSO_NOTED = "Also noted";

/** Markdown to plain sentences. One line per paragraph or list item, each ending in punctuation. */
export function speechText(markdown: string): string {
  const cleaned = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<https?:[^>]*>/g, "")
    .replace(/https?:\/\/[^\s)>\]]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(.+?)\1/gs, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+?)[*_](?=[\s).,;:!?]|$)/g, "$1$2");

  const lines: string[] = [];
  for (const raw of cleaned.split("\n")) {
    const line = raw
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/^\s*>+\s?/, "")
      .replace(/^\s*([-*+]|\d+[.)])\s+/, "")
      .replace(/^\s*\|?[\s:|-]+\|?\s*$/, "")
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .replace(/\s*\|\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line || /^[-*_]{3,}$/.test(line)) continue;
    lines.push(/[.!?:;]["')\]]?$/.test(line) ? line : `${line}.`);
  }
  return lines.join("\n");
}

function longDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function entryLines(entries: ReportEntry[]): string[] {
  return entries.map((entry) => speechText(entry.md)).filter((text) => text.length > 0);
}

/** Chapters in the order the page reads: personal, news, briefing, then the footnotes. */
export function buildChapters(report: ReportJson): Chapter[] {
  const raw: { section: string; title: string; entries: string[] }[] = [];

  for (const group of report.personal) raw.push({ section: SECTION_PERSONAL, title: URGENCY_TITLE[group.urgency], entries: entryLines(group.entries) });
  for (const group of report.news ?? []) raw.push({ section: SECTION_NEWS, title: group.group, entries: entryLines(group.entries) });
  for (const group of report.intel) raw.push({ section: SECTION_INTEL, title: group.domain, entries: entryLines(group.entries) });
  raw.push({ section: SECTION_ALSO_NOTED, title: SECTION_ALSO_NOTED, entries: entryLines(report.alsoNoted) });

  const chapters: Chapter[] = [];
  let lastSection = "";
  for (const group of raw) {
    if (group.entries.length === 0) continue;
    const intro: string[] = [];
    if (chapters.length === 0) intro.push(`Briefing for ${longDate(report.date)}.`);
    if (group.section !== lastSection) intro.push(`${group.section}.`);
    if (group.title !== group.section) intro.push(`${speechText(group.title).replace(/[.!?:;]$/, "")}.`);
    lastSection = group.section;

    const text = [...intro, ...group.entries].join("\n");
    chapters.push({
      index: chapters.length,
      key: createHash("sha256").update(text).digest("hex").slice(0, 16),
      section: group.section,
      title: group.title,
      text,
      words: text.split(/\s+/).filter(Boolean).length,
    });
  }
  return chapters;
}

/**
 * Pieces small enough for one speech request, cut between lines (and between sentences for a
 * single line that is longer than the limit), so no sentence is split in the middle.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= maxChars) {
      pieces.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
      const at = cut > maxChars / 2 ? cut + 1 : Math.max(window.lastIndexOf(" "), maxChars / 2);
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Rough length of a chapter before it exists, so the seek bar has proportions to draw. */
export function estimateDurationMs(text: string): number {
  return Math.round((text.length / 14) * 1000);
}

const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Exact length of an MP3 by walking its frames. The browser cannot be asked before the audio has
 * been downloaded, and the seek bar is drawn before that. Falls back to the byte count at the
 * 128 kbit/s the speech endpoint produces if the stream does not parse.
 */
export function mp3DurationMs(audio: Uint8Array): number {
  let pos = 0;
  if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    pos = 10 + ((audio[6] << 21) | (audio[7] << 14) | (audio[8] << 7) | audio[9]);
  }
  let samples = 0;
  let sampleRate = 0;
  while (pos + 4 <= audio.length) {
    if (audio[pos] !== 0xff || (audio[pos + 1] & 0xe0) !== 0xe0) break;
    const version = (audio[pos + 1] >> 3) & 3;
    const layer = (audio[pos + 1] >> 1) & 3;
    const kbps = (version === 3 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[audio[pos + 2] >> 4];
    const rate = SAMPLE_RATES[version]?.[(audio[pos + 2] >> 2) & 3];
    if (layer !== 1 || !kbps || !rate) break;
    const perFrame = version === 3 ? 1152 : 576;
    const length = Math.floor(((perFrame / 8) * kbps * 1000) / rate) + ((audio[pos + 2] >> 1) & 1);
    samples += perFrame;
    sampleRate = rate;
    pos += length;
  }
  if (samples === 0 || pos < audio.length - 1024) return Math.round((audio.length * 8) / 128);
  return Math.round((samples / sampleRate) * 1000);
}
