/**
 * Reading `raw_items.raw_content` back apart.
 *
 * Ingestion stores a small header block, a blank line, then the body: mail as
 * "Subject: …\nFrom: …" (`src/ingest/imap.ts`), RSS as "Title: …\nSource: …\nPublished: …\nLink: …"
 * (`src/ingest/rss.ts`). Calendar and todo items are JSON and have no header, so every parser here
 * correctly yields null for them.
 */

/** Only the block before the first blank line. */
function headerBlock(rawContent: string): string {
  return rawContent.split("\n\n", 1)[0];
}

/**
 * A quoted reply in the body very often carries its own "From:" line, so the match is restricted
 * to the header block - an unanchored search would show the wrong person.
 */
export function parseSender(rawContent: string | null): string | null {
  if (!rawContent) return null;
  return headerBlock(rawContent).match(/^From:\s*(.+)$/m)?.[1]?.trim() || null;
}

/** Mail subject or RSS title, whichever the header carries. */
export function parseTitle(rawContent: string | null): string | null {
  if (!rawContent) return null;
  return headerBlock(rawContent).match(/^(?:Subject|Title):\s*(.+)$/m)?.[1]?.trim() || null;
}

/**
 * Strip the whitespace that HTML-to-text conversion leaves behind. Newsletters routinely arrive
 * with dozens of blank lines between two sentences, which turns the original view into scrolling
 * past nothing. Only whitespace is touched: every line keeps its content and its order, runs of
 * blank lines collapse to a single one, and trailing spaces (including the non-breaking kind that
 * makes a line look empty but isn't) go away.
 */
export function tidyRawContent(rawContent: string | null): string | null {
  if (!rawContent) return rawContent;
  return rawContent
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
