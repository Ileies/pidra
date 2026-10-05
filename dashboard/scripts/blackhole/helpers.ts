/**
 * Shared pieces of the blackhole suite: which pages live at which paths, what each shows when it
 * works offline, the timing rules, and the small Playwright helpers every step is written with.
 */
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Locator, Page } from "playwright-core";
import { ONLINE_ONLY } from "../../src/lib/offline/onlineOnly.ts";
import * as F from "./fixture.ts";

export const DASHBOARD = join(import.meta.dir, "..", "..");
export const ARTIFACTS = join(tmpdir(), "pidra-blackhole");

/** The rule this suite exists for: a designed state within this, from the tap or the launch. */
export const DESIGNED_WITHIN_MS = 4_000;
/** Scheduling noise on top of a request's own budget before it counts as outliving it. */
export const SLACK_MS = 1_500;

export interface Result {
  lane: string;
  name: string;
  ms: number;
  error?: string;
}

export const results: Result[] = [];

/** Concrete URL per dynamic route id, built from fixture ids. */
const PATHS: Record<string, string> = {
  "/[date]": `/${F.TODAY}`,
  "/[date]/detail/[ids]": `/${F.TODAY}/detail/${F.EXTRACTION.personal}`,
  "/[date]/triage": `/${F.TODAY}/triage`,
  "/entities/[id]": `/entities/${F.ENTITY_ID}`,
  "/sources/[name]": "/sources/example-source",
  "/runs/[id]": "/runs/00000000-0000-4000-8000-000000000000",
};

export function pathFor(id: string): string {
  const path = PATHS[id] ?? id;
  // A new dynamic route fails here until it has a path, rather than silently going untested.
  if (path.includes("[")) throw new Error(`${id}: no concrete path in scripts/blackhole/helpers.ts PATHS`);
  return path;
}

/** What each page shows when it works offline: its own data from the mirror, or the notice. */
export function expectedText(id: string): string {
  const notice = ONLINE_ONLY[id];
  if (notice) return `${notice.label} needs the connection`;
  const MIRRORED: Record<string, string> = {
    "/": F.TEXT.personal,
    "/[date]": F.TEXT.personal,
    "/[date]/detail/[ids]": "Example permit reminder",
    "/notes": F.TEXT.note,
    "/context-builder": F.TEXT.harvest,
    "/context-builder/corrections": F.TEXT.correction,
    "/entities": F.TEXT.entity,
    "/entities/[id]": F.TEXT.entity,
    "/contacts": F.TEXT.contact,
    "/topics": F.TEXT.topic,
    "/settings": "Settings",
    "/privacy": "Privacy Policy",
    "/terms": "Terms of Service",
  };
  const text = MIRRORED[id];
  if (!text) throw new Error(`${id}: no expected text in scripts/blackhole/helpers.ts`);
  return text;
}

/** Text that means the app fell out of its designed states. */
const UNDESIGNED = ["Internal Error", "Nothing stored on this device yet", "Downloading the offline copy", "This site can’t be reached"];

export function remaining(deadline: number): number {
  return Math.max(1, deadline - performance.now());
}

export async function undesigned(page: Page): Promise<string | null> {
  if (page.url().startsWith("chrome-error:")) return "the browser's own error page";
  const text = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
  return UNDESIGNED.find((bad) => text.includes(bad)) ?? null;
}

/**
 * Polled every 25 ms rather than through `waitFor`, whose retries back off to 500 ms: that added
 * up to half a second to a measured time and made a 3.5 s answer read as over the 4 s rule.
 */
export async function visible(locator: Locator, deadline: number): Promise<void> {
  const first = locator.first();
  while (!(await first.isVisible())) {
    if (performance.now() > deadline) throw new Error(`not visible in time: ${String(locator)}`);
    await Bun.sleep(25);
  }
}

/** A tap that gives up when the step's deadline does. */
export function tap(locator: Locator, deadline: number, options: { position?: { x: number; y: number } } = {}): Promise<void> {
  return locator.click({ ...options, timeout: remaining(deadline) });
}

export const INDICATOR = (page: Page) => page.getByRole("button", { name: /^(Synced|Syncing|Offline|Checking)|queued|not saved/ });

/** Client-side navigation exactly as a tap on a link gives it, to any path (injects and clicks an anchor). */
export async function clickLink(page: Page, href: string): Promise<void> {
  await page.evaluate((target) => {
    const a = document.createElement("a");
    a.href = target;
    a.textContent = "blackhole";
    document.body.append(a);
    a.click();
    a.remove();
  }, href);
}

/** The innermost element that holds both, which is the card a row's controls live on. */
export function card(page: Page, text: string, control: Locator): Locator {
  return page.locator("li, div").filter({ has: page.getByText(text, { exact: true }) }).filter({ has: control }).last();
}

export async function expectQueued(page: Page, deadline: number): Promise<void> {
  await visible(page.getByRole("button", { name: /queued/ }), deadline);
}
