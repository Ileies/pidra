import type { simpleParser } from "mailparser";
import { extractJson } from "../ai/openai";

type ParsedMail = Awaited<ReturnType<typeof simpleParser>>;

const UNSUBSCRIBE_SCHEMA = {
  name: "unsubscribe_link",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["unsubscribeUrl"],
    properties: { unsubscribeUrl: { type: ["string", "null"] } },
  },
};

const HTTP_URL = /^https?:\/\//i;

function fromListUnsubscribeHeader(value: unknown): string | null {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return null;
  const urls = [...raw.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
  return urls.find((u) => HTTP_URL.test(u)) ?? null;
}

function fromBodyLink(html: string | undefined): string | null {
  if (!html) return null;
  const anchorMatch = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[^<]{0,80}unsubscribe[^<]{0,80}<\/a>/i);
  const hrefMatch = html.match(/<a[^>]+href=["'](https?:\/\/[^"']*unsubscribe[^"']*)["']/i);
  const url = anchorMatch?.[1] ?? hrefMatch?.[1];
  return url && HTTP_URL.test(url) ? url : null;
}

async function fromAiScan(html: string | undefined): Promise<string | null> {
  if (!html) return null;
  try {
    const result = await extractJson<{ unsubscribeUrl: string | null }>(
      "Find the unsubscribe link in this newsletter email's HTML, if one exists. Return its " +
        "exact href URL, or null if there is none.",
      html.slice(0, 12000),
      { schema: UNSUBSCRIBE_SCHEMA, maxOutputTokens: 200 },
    );
    return result.unsubscribeUrl && HTTP_URL.test(result.unsubscribeUrl) ? result.unsubscribeUrl : null;
  } catch {
    return null;
  }
}

/**
 * Finds an unsubscribe link in a parsed newsletter email, cheapest signal first: the RFC 8058
 * `List-Unsubscribe` header, then an obvious body link, then an AI scan of the raw HTML as a
 * last resort for templates that hide the link behind arbitrary link text. Called at most once
 * per source (see `imap.ts`), so the AI fallback never runs on the hot ingest path repeatedly.
 */
export async function findUnsubscribeLink(parsed: ParsedMail): Promise<string | null> {
  const headerUrl = fromListUnsubscribeHeader(parsed.headers.get("list-unsubscribe"));
  if (headerUrl) return headerUrl;

  const bodyUrl = fromBodyLink(parsed.html || undefined);
  if (bodyUrl) return bodyUrl;

  return fromAiScan(parsed.html || undefined);
}
