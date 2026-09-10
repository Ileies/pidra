/**
 * What the assistant is looking at. A page declares it once, in an `$effect`, and the widget
 * sends it with every turn.
 *
 * The `focus` list is the part that matters most: it hands the model real ids for the rows on
 * screen, which is what makes "die zweite Note oben" resolvable instead of a guess.
 *
 * The server resolves the surface from the route anyway (see `src/ai/surfaces.ts`), so a page that
 * forgets to call `setPageContext` still gets the right capabilities - it just loses the digest
 * and the visible-row ids.
 */

export type Surface = "notes" | "context" | "entities" | "report" | "sources" | "prompts" | "global";

export interface FocusItem {
  kind: string;
  id: string;
  label?: string;
}

export interface PageContext {
  surface: Surface;
  route: string;
  /** One or two sentences: filters, counts, which date - whatever names what is on screen. */
  digest?: string;
  focus?: FocusItem[];
}

const ROUTE_SURFACES: [RegExp, Surface][] = [
  [/^\/notes/, "notes"],
  [/^\/(context-builder|chat)/, "context"],
  [/^\/entities/, "entities"],
  [/^\/sources/, "sources"],
  [/^\/prompts/, "prompts"],
  [/^\/(\d{4}-\d{2}-\d{2})(\/|$)/, "report"],
  [/^\/$/, "report"],
];

/** Mirrors the server's fallback so the widget's header is right before the first turn. */
export function surfaceForRoute(pathname: string): Surface {
  for (const [pattern, surface] of ROUTE_SURFACES) {
    if (pattern.test(pathname)) return surface;
  }
  return "global";
}

/** Trimmed to keep a turn's prompt small. The server caps these again. */
export const MAX_FOCUS_ITEMS = 30;
export const MAX_FOCUS_LABEL = 80;

export function focusFrom<T>(
  rows: T[],
  kind: string,
  pick: (row: T) => { id: string; label?: string | null },
): FocusItem[] {
  return rows.slice(0, MAX_FOCUS_ITEMS).map((row) => {
    const { id, label } = pick(row);
    return { kind, id, label: label ? label.slice(0, MAX_FOCUS_LABEL) : undefined };
  });
}
