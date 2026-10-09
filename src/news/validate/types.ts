import type { BraveResult } from "../../search/brave";
import type { DeskId } from "../config";

/** A story as the desk's JSON schema returns it. */
export interface DeskStory {
  headline: string;
  summary: string;
  context: string;
  significance: 1 | 2 | 3 | 4 | 5;
  status: "new" | "update";
  confidence: "confirmed" | "reported" | "unconfirmed";
  region: string;
  topic: string;
  happened_at: string;
  entities: string[];
  sources: { publisher: string; title: string; url: string }[];
}

/** The verdict, stored on the extraction as `extracted_json.validation` and read by the gate. */
export interface NewsValidation {
  /** At least one source is a URL the search returned. Null when the call reported no sources. */
  verified: boolean | null;
  /** Cited URLs that the search never returned, for the record. */
  unverifiedUrls: string[];
  /** Whether the development falls inside the window. Null when the date could not be read. */
  inWindow: boolean | null;
  /** Set when another desk's story in the same run is the same event and was kept instead. */
  duplicateOf: { desk: DeskId; headline: string } | null;
  /** Set when the reader was already told this story on an earlier day and nothing new happened. */
  alreadyReported: { date: string; headline: string } | null;
  /**
   * A home-desk story about one of the countries the reader follows from abroad. Not a failed
   * check but a higher bar: the desk is told those countries get their top headlines only, and on
   * the first real run it still returned three minor German stories that crowded out the city.
   * Absent on rows stored before the flag existed, which reads as false.
   */
  abroad?: boolean;
}

/**
 * A story as stored on its extraction row (`extractions.extracted_json` where the raw item has
 * `source_type = 'web_news'`). `key_claim` holds the summary, the field newsletter
 * items use, so the cards, triage and "More on this" read a news story without a special case.
 * `sources` has the unverified URLs filtered out (see `toExtraction`).
 */
export interface NewsExtraction {
  desk: DeskId;
  headline: string;
  key_claim: string;
  context: string;
  significance: DeskStory["significance"];
  status: DeskStory["status"];
  confidence: DeskStory["confidence"];
  region: string;
  topic: string;
  happened_at: string;
  entities: string[];
  sources: DeskStory["sources"];
  validation: NewsValidation;
}

/** A story as the model returns it: sources are only ids into the search results, see `resolveStorySources`. */
export type CitedStory = Omit<DeskStory, "sources"> & { sources: { id: string; publisher: string }[] };

/** The model selects source ids; code supplies the exact Brave URL and title. */
export function resolveStorySources(story: CitedStory, sourceById: Map<string, BraveResult>): DeskStory {
  return {
    ...story,
    sources: story.sources.flatMap(({ id, publisher }) => {
      const result = sourceById.get(id);
      if (!result || !URL.canParse(result.url)) return [];
      return [{ publisher: publisher.trim() || new URL(result.url).hostname.replace(/^www\./, ""), title: result.title, url: result.url }];
    }),
  };
}

/** A checked story as its extraction row stores it. */
export function toExtraction(desk: DeskId, story: DeskStory, validation: NewsValidation): NewsExtraction {
  return {
    desk,
    headline: story.headline,
    key_claim: story.summary,
    context: story.context,
    significance: story.significance,
    status: story.status,
    confidence: story.confidence,
    region: story.region,
    topic: story.topic,
    happened_at: story.happened_at,
    entities: story.entities,
    sources: story.sources.filter((source) => !validation.unverifiedUrls.includes(source.url)),
    validation,
  };
}

/** The inverse of `toExtraction`: a stored story back as a desk story, for the duplicate check. */
export function storyFromStored(json: NewsExtraction): DeskStory {
  return {
    headline: json.headline,
    summary: json.key_claim,
    context: json.context,
    significance: json.significance,
    status: json.status,
    confidence: json.confidence,
    region: json.region,
    topic: json.topic,
    happened_at: json.happened_at,
    entities: json.entities ?? [],
    sources: json.sources ?? [],
  };
}

/** A story from a previous briefing that the reader actually saw. */
export interface ReportedStory {
  date: string;
  headline: string;
  urls: string[];
  /** Present on recent stories only (`pipeline/told.ts`); what tells an update from a repeat. */
  summary?: string;
}

export interface Candidate {
  desk: DeskId;
  /** The desk's position in `DESKS`, the tie-break when two desks found the same story. */
  deskOrder: number;
  story: DeskStory;
  validation: NewsValidation;
  /** Already stored by an earlier run of the same day. Compared against, never re-judged. */
  stored: boolean;
}
