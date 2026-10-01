/**
 * The layout lane: what the pages look like above phone width.
 *
 * Every other lane drives Chrome at 390x844, so nothing in `bun run check` had rendered a page at
 * a laptop or desktop size. The `/[date]` grid collapse, the `size` mismatch on the management
 * pages and the Navbar wrapping below 1280px (all 2026-09-29) were each visible on the first look
 * at a wide screen and none of them would have failed a check.
 *
 * Online, against the layout snapshot (`fixture.ts`: several rows per table, a report with every
 * urgency and section, a document with its section rail), at three desktop widths. For every
 * mirrored page it asserts, from the rendered DOM rather than a pixel diff:
 *
 * - a designed page: no error boundary, no `Internal Error`;
 * - no horizontal scroll, from the page or from `<main>`;
 * - one header row: the navbar does not wrap and the page title is not truncated;
 * - the frame is the width its `size` allows, centred, with no blank margin beyond that cap;
 * - the content fills that frame instead of sitting in one corner of it;
 * - `/[date]`: the article and its rail share a row, the rail to the right.
 *
 * Online-only pages cannot render without a database, so they stay out; `dashboard/tests/` covers
 * those by rendering the component directly.
 */

import { mkdirSync } from "node:fs";
import type { Browser, Page } from "playwright-core";
import * as F from "./fixture.ts";
import { LaneProxy } from "./proxy.ts";

export interface LayoutRoute {
  id: string;
  path: string;
  text: string;
}

export interface LayoutResult {
  lane: string;
  name: string;
  ms: number;
  error?: string;
}

/** 1280 is the first width with the full navbar, 1366 the common laptop, 1920 past the 1600px cap. */
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

/** Every page is `app` width unless it is prose (`$lib/ui/layout.ts`). */
const SIZE: Record<string, "read" | "legal"> = {
  "/[date]/detail/[ids]": "read",
  "/privacy": "legal",
  "/terms": "legal",
};

/** A row beyond the first on each table-like page, so a fixture shrunk back to one row fails here. */
const SECOND_ROW: Record<string, string> = {
  "/notes": "Example bulk note 2",
  "/rules": "Example standing rule 2",
  "/entities": "Example Bulk Entity 2",
  "/contacts": "Example Sender 2",
  "/topics": "Example bulk story 2",
  "/context-builder/corrections": "Example correction statement 2",
};

const UNDESIGNED = ["Internal Error", "Nothing stored on this device yet", "Downloading the offline copy"];

interface Facts {
  parentWidth: number;
  cap: number;
  mainLeft: number;
  mainWidth: number;
  parentLeft: number;
  contentWidth: number;
  childSpan: number;
  pageOverflow: number;
  mainOverflow: number;
  headerHeight: number;
  navRows: number;
  navWrapped: boolean;
  titleTruncated: boolean;
  grid: { display: string; articleRight: number; railLeft: number; railTop: number; articleTop: number; articleWidth: number; railWidth: number } | null;
}

async function measure(page: Page, size: string): Promise<Facts> {
  return page.evaluate((frame) => {
    const main = document.querySelector("main") as HTMLElement;
    const parent = main.parentElement as HTMLElement;
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(--container-${frame})`;
    // Inside <main>, because the legal cap is in `ch` and so depends on the page's font size.
    main.append(probe);
    const cap = probe.getBoundingClientRect().width;
    probe.remove();

    const rect = main.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const style = getComputedStyle(main);
    const contentWidth = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const children = [...main.children].filter((c) => getComputedStyle(c).display !== "none") as HTMLElement[];
    const boxes = children.map((c) => c.getBoundingClientRect());
    const childSpan = boxes.length === 0 ? 0 : Math.max(...boxes.map((b) => b.right)) - Math.min(...boxes.map((b) => b.left));

    const doc = document.documentElement;
    const header = document.querySelector("header[data-app-header]") as HTMLElement | null;
    const nav = header?.querySelector('nav[aria-label="Main"]') as HTMLElement | null;
    const items = nav ? [...nav.querySelectorAll("a, button")].filter((e) => (e as HTMLElement).offsetParent !== null) : [];
    const tops = items.map((e) => e.getBoundingClientRect().top);
    const title = header?.querySelector("span.truncate") as HTMLElement | null;

    let grid: Facts["grid"] = null;
    if (style.display === "grid") {
      const article = main.firstElementChild as HTMLElement;
      const rail = main.querySelector(":scope > aside") as HTMLElement | null;
      if (rail) {
        const a = article.getBoundingClientRect();
        const r = rail.getBoundingClientRect();
        grid = { display: style.display, articleRight: a.right, railLeft: r.left, railTop: r.top, articleTop: a.top, articleWidth: a.width, railWidth: r.width };
      }
    }

    return {
      parentWidth: parentRect.width,
      cap,
      mainLeft: rect.left,
      mainWidth: rect.width,
      parentLeft: parentRect.left,
      contentWidth,
      childSpan,
      pageOverflow: Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - document.body.clientWidth),
      mainOverflow: main.scrollWidth - main.clientWidth,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      navRows: tops.length === 0 ? 0 : new Set(tops.map((t) => Math.round(t / 6))).size,
      navWrapped: nav ? nav.getBoundingClientRect().height > 48 : false,
      titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : false,
      grid,
    };
  }, size);
}

function problemsOf(route: LayoutRoute, width: number, facts: Facts): string[] {
  const size = SIZE[route.id] ?? "app";
  const problems: string[] = [];
  const expected = Math.min(facts.parentWidth, facts.cap);

  if (facts.pageOverflow > 1) problems.push(`the page scrolls sideways by ${Math.round(facts.pageOverflow)} px`);
  if (facts.mainOverflow > 1) problems.push(`<main> overflows its frame by ${Math.round(facts.mainOverflow)} px`);

  if (facts.headerHeight > 72 || facts.navWrapped || facts.navRows > 1) problems.push(`the header wraps (${Math.round(facts.headerHeight)} px tall, ${facts.navRows} nav rows)`);
  if (facts.titleTruncated) problems.push("the page title in the header is truncated");

  if (Math.abs(facts.mainWidth - expected) > 2) problems.push(`the ${size} frame is ${Math.round(facts.mainWidth)} px, its cap allows ${Math.round(expected)} px`);
  const margin = (facts.parentWidth - facts.mainWidth) / 2;
  if (Math.abs(facts.mainLeft - facts.parentLeft - margin) > 2) problems.push("the frame is not centred");

  // The content, not the frame, is what a blank margin is made of: a card list that stops halfway
  // across leaves the same hole as a page frame set to the wrong size.
  if (facts.childSpan < facts.contentWidth * 0.9) problems.push(`the content spans ${Math.round(facts.childSpan)} of ${Math.round(facts.contentWidth)} px of its frame`);

  if (route.id === "/[date]" && width >= 1280) {
    const grid = facts.grid;
    if (!grid) problems.push("no rail beside the article");
    else {
      if (grid.articleRight > grid.railLeft + 1) problems.push("the article overlaps the rail");
      if (Math.abs(grid.railTop - grid.articleTop) > 40) problems.push(`the rail sits ${Math.round(grid.railTop - grid.articleTop)} px below the article, not beside it`);
      if (grid.articleWidth < grid.railWidth * 2) problems.push(`the article collapsed to ${Math.round(grid.articleWidth)} px next to a ${Math.round(grid.railWidth)} px rail`);
    }
  }
  return problems;
}

async function check(page: Page, route: LayoutRoute, width: number): Promise<string | undefined> {
  const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const bad = UNDESIGNED.find((marker) => text.includes(marker));
  if (bad) return `shows ${bad}`;
  if (await page.getByRole("heading", { name: /^(404|Not found|Internal Error)$/i }).isVisible()) return "opened an error page";

  const second = SECOND_ROW[route.id];
  if (second && !text.includes(second)) return `the layout fixture's second row is missing ("${second}")`;

  const problems = problemsOf(route, width, await measure(page, SIZE[route.id] ?? "app"));
  return problems.length > 0 ? problems.join("; ") : undefined;
}

export async function runLayout(browser: Browser, upstream: string, routes: LayoutRoute[], artifacts: string): Promise<LayoutResult[]> {
  const results: LayoutResult[] = [];
  await Promise.all(
    VIEWPORTS.map(async (viewport) => {
      const lane = `layout-${viewport.width}`;
      const proxy = new LaneProxy(upstream, { etag: F.LAYOUT_ETAG, body: F.LAYOUT_SNAPSHOT });
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
      // The navbar shows from this cookie alone (see `runLane` in `run.ts`).
      await context.addCookies([{ name: "pidra_ui", value: "1", url: proxy.origin }]);
      const page = await context.newPage();
      try {
        for (const route of routes) {
          const started = performance.now();
          let error: string | undefined;
          try {
            await page.goto(`${proxy.origin}${route.path}`, { timeout: 30_000 });
            await page.getByText(route.text).first().waitFor({ state: "visible", timeout: 15_000 });
            // The sync indicator changes width as it settles, which moves the header while measured.
            await page.getByRole("button", { name: "Synced", exact: true }).waitFor({ timeout: 10_000 });
            error = await check(page, route, viewport.width);
          } catch (err) {
            error = err instanceof Error ? err.message.split("\n")[0] : String(err);
          }
          if (error) {
            mkdirSync(artifacts, { recursive: true });
            await page.screenshot({ path: `${artifacts}/${lane}-${route.id.replace(/[^a-z0-9]+/gi, "_")}.png` }).catch(() => {});
          }
          results.push({ lane, name: `${route.id}: layout at ${viewport.width}px`, ms: Math.round(performance.now() - started), error });
        }
      } finally {
        await context.close().catch(() => {});
        proxy.stop();
      }
    }),
  );
  return results;
}
