/**
 * The route registry: one place that names every page.
 *
 * Before this file the app declared its routes three times with no shared source - `LINKS` in
 * `Navbar.svelte`, `ROUTE_SURFACES` in `assistant/pageContext.ts`, and `ROUTE_SURFACES` again in
 * the pipeline's `src/ai/surfaces.ts`. Adding a page meant remembering all three, and forgetting
 * the surface map silently fell back to `global`, which is a capability decision made by
 * omission rather than on purpose.
 *
 * Now: the navbar renders from here, the mobile tab bar and overflow sheet read the same list,
 * the assistant's client-side surface fallback derives from it, and the pipeline's map is checked
 * against it by `scripts/check-route-surfaces.ts` (part of the root `bun run check`).
 *
 * Adding a page means adding one entry.
 */

import type { Surface } from "$lib/assistant/pageContext";

export type NavGroup = "report" | "intel" | "memory" | "system" | "chat";

export interface RouteDef {
  /** Where the link points. */
  href: string;
  /**
   * The SvelteKit route id this entry owns. Dynamic segments included, so `page.route.id` can be
   * matched exactly rather than by prefix guessing.
   */
  id: string;
  /** Nav label. Also the page title in the mobile header. */
  label: string;
  /** Assistant surface. Must agree with `src/ai/surfaces.ts`; the check script enforces that. */
  surface: Surface;
  group: NavGroup;
  /** 24x24 stroke path data, for the tab bar and the overflow sheet. */
  icon: string;
  /**
   * Child routes that belong to this entry for active-state and surface purposes, e.g. the source
   * detail page under /sources. Route ids, not hrefs.
   */
  children?: string[];
  /** Present on the four mobile tab destinations, in bar order. */
  tab?: number;
  /** Kept out of the desktop nav row: reachable, but not one of the ten things always on screen. */
  secondary?: boolean;
}

const ICON = {
  report: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  sources: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  entities: "M12 3v4M12 17v4M5.5 7.5l2.8 2.8M15.7 13.7l2.8 2.8M3 12h4M17 12h4M5.5 16.5l2.8-2.8M15.7 10.3l2.8-2.8M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  topics: "M4 6h16M4 12h10M4 18h7M18 15v6M15 18h6",
  contacts: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17 11l2 2 4-4",
  notes: "M6 3h9l5 5v13H6zM15 3v5h5M9 13h7M9 17h5",
  rules: "M5 4h14v16l-7-3-7 3zM9 9h6M9 13h4",
  skills: "M14.7 6.3a4 4 0 1 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-2.4-.6-.6-2.4z",
  prompts: "M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5",
  runs: "M4 19V5M4 19h16M8 15l3.5-4.5 3 2.5L19 7",
  questions: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.7-.8 1.2v.4M12 17h.01",
  chat: "M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-2.8-.4L3 21l1.6-4.8A8.2 8.2 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.3 8.4 8.4 0 0 1 8.4 8.3z",
  context: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

/**
 * Order is the desktop nav order. `report` first, then the three groups, then chat.
 * The dividers in the nav row fall between groups.
 */
export const ROUTES: RouteDef[] = [
  {
    href: "/",
    id: "/[date]",
    label: "Report",
    surface: "report",
    group: "report",
    icon: ICON.report,
    children: ["/[date]/detail/[ids]"],
    tab: 0,
  },
  {
    href: "/sources",
    id: "/sources",
    label: "Sources",
    surface: "sources",
    group: "intel",
    icon: ICON.sources,
    children: ["/sources/[name]"],
  },
  {
    href: "/entities",
    id: "/entities",
    label: "Entities",
    surface: "entities",
    group: "intel",
    icon: ICON.entities,
    children: ["/entities/[id]"],
  },
  {
    href: "/topics",
    id: "/topics",
    label: "Topics",
    // `global` on purpose, not by omission: active_topics belongs to the pipeline and no skill
    // may write it, so there is nothing structural here for the assistant to change.
    surface: "global",
    group: "intel",
    icon: ICON.topics,
  },
  {
    href: "/contacts",
    id: "/contacts",
    label: "Contacts",
    surface: "context",
    group: "intel",
    icon: ICON.contacts,
  },
  {
    href: "/notes",
    id: "/notes",
    label: "Notes",
    surface: "notes",
    group: "memory",
    icon: ICON.notes,
    tab: 1,
  },
  {
    href: "/rules",
    id: "/rules",
    label: "Rules",
    surface: "context",
    group: "memory",
    icon: ICON.rules,
  },
  {
    href: "/context-builder",
    id: "/context-builder",
    label: "Context",
    surface: "context",
    group: "memory",
    icon: ICON.context,
  },
  {
    href: "/skills",
    id: "/skills",
    label: "Skills",
    surface: "global",
    group: "system",
    icon: ICON.skills,
  },
  {
    href: "/prompts",
    id: "/prompts",
    label: "Prompts",
    surface: "prompts",
    group: "system",
    icon: ICON.prompts,
  },
  {
    href: "/runs",
    id: "/runs",
    label: "Runs",
    surface: "global",
    group: "system",
    icon: ICON.runs,
  },
  {
    href: "/questions",
    id: "/questions",
    label: "Questions",
    surface: "global",
    group: "system",
    icon: ICON.questions,
    secondary: true,
  },
  {
    href: "/chat",
    id: "/chat",
    label: "Chat",
    surface: "context",
    group: "chat",
    icon: ICON.chat,
    tab: 2,
  },
];

export const MORE_ICON = ICON.more;

/** Desktop nav order, grouped. Dividers go between groups. */
export const NAV_GROUPS: NavGroup[] = ["report", "intel", "memory", "system", "chat"];

/** The four mobile tab destinations, in bar order. The fourth is More, which is not a route. */
export const TABS = ROUTES.filter((r) => r.tab !== undefined).sort((a, b) => a.tab! - b.tab!);

const BY_ID = new Map(ROUTES.flatMap((r) => [[r.id, r] as const, ...(r.children ?? []).map((c) => [c, r] as const)]));

/** The registry entry that owns a SvelteKit route id, including its child routes. */
export function routeFor(routeId: string | null | undefined): RouteDef | undefined {
  if (!routeId) return undefined;
  return BY_ID.get(routeId);
}

/** True when a nav entry should render as the current page. */
export function isCurrent(entry: RouteDef, routeId: string | null | undefined): boolean {
  return routeFor(routeId)?.href === entry.href;
}

/**
 * Surface for a pathname, for the assistant's client-side fallback before a page declares its own
 * context. The server resolves this again from the route and its answer wins.
 */
export function surfaceForPath(pathname: string): Surface {
  const path = pathname.split("?")[0];
  if (/^\/(\d{4}-\d{2}-\d{2})(\/|$)/.test(path) || path === "/") return "report";
  const match = ROUTES.filter((r) => r.href !== "/")
    .filter((r) => path === r.href || path.startsWith(`${r.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.surface ?? "global";
}
