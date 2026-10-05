/**
 * Markdown rendering, sanitised. The only place in the dashboard that produces HTML for
 * `{@html}`; nothing else may call `marked`.
 *
 * `marked` does not sanitise, and the input is model output derived from ingested newsletter
 * HTML and personal mail, so it is untrusted. The allowlist below is what a briefing can
 * legitimately contain. Anything else (script, iframe, event handler, `javascript:` href, style
 * attribute) is removed rather than escaped, so a stray `<script>` is not shown as visible text.
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

// Runs after attribute sanitising, so the FORBID_ATTR entry for `target` below only stops
// authored markup; the links set here are ours. `noopener` keeps the new tab from reaching back.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A" && /^https?:/i.test(node.getAttribute("href") ?? "")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

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
    // `target` and `rel` are not on the allowlist, so authored markup cannot set them; the hook above does.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "img", "svg", "math"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick", "target", "srcset", "formaction"],
  });
}
