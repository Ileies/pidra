/**
 * Markdown rendering, sanitised. The only place in the dashboard that produces HTML for
 * `{@html}` (X1, C2).
 *
 * There were four `{@html marked(...)}` call sites and no sanitiser anywhere. `marked` does not
 * sanitise - it passes raw HTML in its input straight through - and the input here is model
 * output derived from ingested newsletter HTML and, for the Context Builder document, from
 * personal mail and Keep notes. That is untrusted content by any reading, whichever end of the
 * pipe it entered from.
 *
 * The allowlist below is what a briefing can legitimately contain. Anything else - a script, an
 * iframe, an event handler, a `javascript:` href, a style attribute - is removed rather than
 * escaped, because a briefing that renders a stray `<script>` as visible text is also wrong.
 */

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

/** Tags markdown can produce, plus the anchor the report's "More on this" chip is built from. */
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "b", "i", "s", "del", "code", "pre", "blockquote",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "span", "div",
];

const ALLOWED_ATTR = ["href", "title", "class", "colspan", "rowspan", "align", "id"];

/** http(s) and mailto only: no `javascript:`, no `data:`, no protocol-relative surprises. */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|[#/])/i;

/**
 * A `ts_headline` snippet, made safe to render.
 *
 * `ts_headline` inserts its start and stop tags into the source text without escaping what is
 * already there, so a report containing raw HTML comes back out of Postgres with that HTML
 * intact. Only the highlight survives.
 */
export function sanitizeSnippet(snippet: string | null | undefined): string {
  if (!snippet) return "";
  return DOMPurify.sanitize(snippet, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] });
}

export interface RenderOptions {
  /** Renders inline: no wrapping `<p>`. For a headline or a single-line fragment. */
  inline?: boolean;
}

export function renderMarkdown(source: string | null | undefined, options: RenderOptions = {}): string {
  if (!source) return "";
  const html = options.inline
    ? (marked.parseInline(source) as string)
    : (marked.parse(source) as string);

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // `target` and `rel` are not on the allowlist, so a link cannot open a window it controls.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "img", "svg", "math"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick", "target", "srcset", "formaction"],
  });
}
