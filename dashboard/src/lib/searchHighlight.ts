// Helpers for the Context Builder document view (`routes/context-builder/+page.svelte`, DocSearch,
// QuickLinks): operate on HTML already produced by `renderMarkdown()`.

export interface DocHeading {
  id: string;
  title: string;
  /** Quick Links text: the title without its trailing parenthetical explanation. */
  label: string;
}

/** `renderMarkdown()` output is entity-escaped, so a plain tag strip leaves `&amp;` behind. */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

function shortLabel(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tags each `<h1>` (the document's five contract-mandated sections, CLAUDE.md) with a scroll
 *  anchor, and reports what it found so Quick Links can list them - generically, rather than
 *  hardcoding the five titles, so a wording change on the pipeline side does not silently leave a
 *  stale Quick Links entry. */
export function withHeadingIds(html: string): { html: string; headings: DocHeading[] } {
  const headings: DocHeading[] = [];
  const tagged = html.replace(/<h1(\s[^>]*)?>([\s\S]*?)<\/h1>/g, (_m, attrs: string | undefined, inner: string) => {
    const title = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
    const id = `doc-${slugify(title)}`;
    headings.push({ id, title, label: shortLabel(title) });
    return `<h1${attrs ?? ""} id="${id}" class="cb-anchor">${inner}</h1>`;
  });
  return { html: tagged, headings };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps matches in a `<mark>` without ever touching tag content: the input is always
 *  already-sanitised HTML from `renderMarkdown()`, split on its own tags, and the replacement is
 *  the matched substring itself, so this can only ever add a wrapper around text that was
 *  already safe to render. */
export function highlightHtml(html: string, query: string): string {
  const q = query.trim();
  if (!q) return html;
  const re = new RegExp(escapeRegExp(q), "gi");
  return html
    .split(/(<[^>]+>)/g)
    .map((chunk, i) => (i % 2 === 1 ? chunk : chunk.replace(re, (m) => `<mark class="search-hit">${m}</mark>`)))
    .join("");
}
