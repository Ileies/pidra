/**
 * The blackhole suite (OFFLINE_PLAN.md §14.3, H5): "no request can hang" as something a check
 * proves, rather than something a phone once showed.
 *
 * Builds the dashboard, starts the production server with no database behind it, and drives the
 * system Chrome at 390x844 through a proxy per lane (`proxy.ts`) that can forward, swallow, gate or
 * refuse. Every lane first opens the app online so the worker installs and the mirror fills from a
 * synthetic snapshot (`fixture.ts`), then cuts the network in its mode and, for every page in
 * `src/lib/routes.ts`:
 *
 * 1. navigates to it client-side while the app still believes it is online - the Questions tap of
 *    2026-09-25 that spun for minutes and ended in "500 Internal Error";
 * 2. cold-starts it in a new tab, with the worker's belief reset as if it had been stopped;
 * 3. taps each of its primary controls.
 *
 * Each must reach a designed state within 4 s: the mirror's own data, `OfflineNotice`, or the
 * control's offline answer. Then no request any caller made - page, SvelteKit or worker - may have
 * outlived its budget. A lane that wrote reopens offline (the queue survived), reconnects, and
 * checks every queued write reached the stand-in exactly once, in order.
 *
 * Nothing reaches a database or the skills bridge: the server's `DATABASE_URL` and
 * `SKILLS_BRIDGE_URL` point at a closed port, the snapshot is the fixture and every write is
 * answered by the proxy.
 *
 *   bun run scripts/blackhole/run.ts                build, then every lane
 *   bun run scripts/blackhole/run.ts --no-build     against the existing build/
 *   bun run scripts/blackhole/run.ts --only gated   one mode (blackhole | gated | refused | offline)
 *
 * Chrome is `PIDRA_CHROME`, else the first of google-chrome, chromium on PATH.
 */

import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { MIRRORED_ROUTES, ONLINE_ONLY, STATIC_OFFLINE_ROUTES } from "../../src/lib/routes.ts";
import { LaneProxy, type Mode, type Tracked } from "./proxy.ts";
import * as F from "./fixture.ts";

const DASHBOARD = join(import.meta.dir, "..", "..");
const ARTIFACTS = join(tmpdir(), "pidra-blackhole");
const args = process.argv.slice(2);

/** The rule of §14.3 H5: a designed state within this, from the tap or the launch. */
const DESIGNED_WITHIN_MS = 4_000;
/** Scheduling noise on top of a request's own budget before it counts as outliving it. */
const SLACK_MS = 1_500;

// --- which pages, at which paths ---

const PATHS: Record<string, string> = {
  "/[date]": `/${F.TODAY}`,
  "/[date]/detail/[ids]": `/${F.TODAY}/detail/${F.EXTRACTION.personal}`,
  "/[date]/triage": `/${F.TODAY}/triage`,
  "/entities/[id]": `/entities/${F.ENTITY_ID}`,
  "/sources/[name]": "/sources/example-source",
};

function pathFor(id: string): string {
  const path = PATHS[id] ?? id;
  // A new dynamic route fails here until it has a path, rather than silently going untested.
  if (path.includes("[")) throw new Error(`${id}: no concrete path in scripts/blackhole/run.ts PATHS`);
  return path;
}

/** What each page shows when it works offline: its own data from the mirror, or the notice. */
function expectedText(id: string): string {
  const notice = ONLINE_ONLY[id];
  if (notice) return `${notice.label} needs the connection`;
  const MIRRORED: Record<string, string> = {
    "/": F.TEXT.personal,
    "/[date]": F.TEXT.personal,
    "/[date]/detail/[ids]": "Example permit reminder",
    "/notes": F.TEXT.note,
    "/rules": F.TEXT.rule,
    "/context-builder": F.TEXT.harvest,
    "/entities": F.TEXT.entity,
    "/entities/[id]": F.TEXT.entity,
    "/contacts": F.TEXT.contact,
    "/topics": F.TEXT.topic,
    "/privacy": "Privacy Policy",
    "/terms": "Terms of Service",
  };
  const text = MIRRORED[id];
  if (!text) throw new Error(`${id}: no expected text in scripts/blackhole/run.ts`);
  return text;
}

/** Text that means the app fell out of its designed states. */
const UNDESIGNED = ["Internal Error", "Nothing stored on this device yet", "Downloading the offline copy", "This site can’t be reached"];

// --- the budgets every request is held to (`net.ts` BUDGET, the worker's constants) ---

const WRITE = /^\/api\/(notes(\/[^/]+(\/restore)?)?|feedback|rules(\/[^/]+)?)$/;

function budgetFor(t: Tracked): number {
  const path = t.path.split("?")[0];
  if (path === "/api/health" || path.endsWith("/_app/version.json")) return 3_000;
  // `sync.ts` sends the snapshot and the outbox's writes under BUDGET.sync.
  if (path === "/api/offline/snapshot" || (t.method !== "GET" && WRITE.test(path))) return 60_000;
  if (path.endsWith("/__data.json") || path === "/api/assistant/chat") return 30_000;
  if (path.startsWith("/api/") || t.path.includes("?/")) return 15_000;
  // Documents and assets: the worker's ASSET_BUDGET_MS.
  return 10_000;
}

// --- reporting ---

interface Result {
  lane: string;
  name: string;
  ms: number;
  error?: string;
}

const results: Result[] = [];

function remaining(deadline: number): number {
  return Math.max(1, deadline - performance.now());
}

async function undesigned(page: Page): Promise<string | null> {
  if (page.url().startsWith("chrome-error:")) return "the browser's own error page";
  const text = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
  return UNDESIGNED.find((bad) => text.includes(bad)) ?? null;
}

/**
 * Polled every 25 ms rather than through `waitFor`, whose retries back off to 500 ms: that added
 * up to half a second to a measured time and made a 3.5 s answer read as over the 4 s rule.
 */
async function visible(locator: Locator, deadline: number): Promise<void> {
  const first = locator.first();
  while (!(await first.isVisible())) {
    if (performance.now() > deadline) throw new Error(`not visible in time: ${String(locator)}`);
    await Bun.sleep(25);
  }
}

// --- the controls, per route. Each starts where the previous one left the page. ---

interface Control {
  name: string;
  run: (page: Page, deadline: number) => Promise<void>;
}

const INDICATOR = (page: Page) => page.getByRole("button", { name: /^(Online|Offline|Checking)|queued|not saved/ });

async function clickLink(page: Page, href: string): Promise<void> {
  // A client-side navigation exactly as a tap on a link gives it, to any path.
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
function card(page: Page, text: string, control: Locator): Locator {
  return page.locator("li, div").filter({ has: page.getByText(text, { exact: true }) }).filter({ has: control }).last();
}

async function expectQueued(page: Page, deadline: number): Promise<void> {
  await visible(page.getByRole("button", { name: /queued/ }), deadline);
}

const CONTROLS: Record<string, Control[]> = {
  "/[date]": [
    {
      name: "rate an entry",
      async run(page, deadline) {
        const plus = page.getByRole("button", { name: "Relevant - this was worth reading" }).first();
        await plus.click({ timeout: remaining(deadline) });
        await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') !== null, null, { timeout: remaining(deadline) });
        await expectQueued(page, deadline);
      },
    },
    {
      name: "open the sources inline",
      async run(page, deadline) {
        await page.getByRole("link", { name: /^More on this/ }).first().click({ timeout: remaining(deadline) });
        await visible(page.getByText("Example permit reminder"), deadline);
      },
    },
    {
      name: "open the archive",
      async run(page, deadline) {
        await page.getByRole("button", { name: /Today/ }).click({ timeout: remaining(deadline) });
        await visible(page.getByText("Recent reports"), deadline);
        await visible(page.locator(`a[href="/${F.YESTERDAY}"]`), deadline);
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "step to the previous day",
      async run(page, deadline) {
        await page.getByRole("link", { name: /Previous day/ }).click({ timeout: remaining(deadline) });
        await visible(page.getByText(F.TEXT.yesterday), deadline);
      },
    },
    {
      name: "open a day with no report",
      async run(page, deadline) {
        await clickLink(page, `/${F.EMPTY_DAY}`);
        await visible(page.getByText(/^No report for/), deadline);
        await visible(page.getByText("Running the pipeline needs the connection."), deadline);
        if (await page.getByRole("button", { name: "Run pipeline now" }).isEnabled()) throw new Error("Run pipeline now is enabled offline");
      },
    },
    {
      name: "search the offline copy",
      async run(page, deadline) {
        await clickLink(page, `/${F.TODAY}`);
        await visible(page.getByText(F.TEXT.personal), deadline);
        await page.keyboard.press("/");
        await page.keyboard.type("permit");
        await visible(page.getByText(/^Offline: searching the copy on this device/), deadline);
        await visible(page.getByRole("dialog").getByText(/permit/i), deadline);
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "open the sync sheet",
      async run(page, deadline) {
        await INDICATOR(page).click({ timeout: remaining(deadline) });
        await visible(page.getByText("Sync status"), deadline);
        await visible(page.getByRole("dialog").getByText("Rating"), deadline);
        await page.keyboard.press("Escape");
      },
    },
  ],
  "/[date]/detail/[ids]": [
    {
      name: "rate an extraction",
      async run(page, deadline) {
        const minus = page.getByRole("button", { name: "Not relevant" }).first();
        await minus.click({ timeout: remaining(deadline) });
        await page.waitForFunction(
          () => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Not relevant") && b.getAttribute("aria-pressed") === "true"),
          null,
          { timeout: remaining(deadline) },
        );
        await expectQueued(page, deadline);
      },
    },
    {
      name: "go deeper is online-only",
      async run(page, deadline) {
        await visible(page.getByText("Going deeper needs the connection."), deadline);
        if (await page.getByRole("button", { name: /go deeper/ }).isEnabled()) throw new Error("Summarise and go deeper is enabled offline");
      },
    },
  ],
  "/notes": [
    {
      name: "create a note",
      async run(page, deadline) {
        await page.getByRole("button", { name: "+ New note" }).click({ timeout: remaining(deadline) });
        await page.getByLabel("New note content").fill("Offline note from the suite");
        await page.getByRole("button", { name: "Add", exact: true }).click({ timeout: remaining(deadline) });
        const text = "Offline note from the suite";
        await visible(page.getByText(text, { exact: true }), deadline);
        await visible(card(page, text, page.getByText("Queued", { exact: true })), deadline);
      },
    },
    {
      name: "open a note's history",
      async run(page, deadline) {
        await page.getByText("1 change", { exact: true }).click({ timeout: remaining(deadline) });
        // Known offline it is never sent; still checking, it is sent and cut off by the probe.
        await visible(page.getByText(/^(Needs the connection\.|Lost the connection before the server answered\.)$/), deadline);
      },
    },
    {
      name: "edit a note",
      async run(page, deadline) {
        await page.getByRole("button", { name: F.TEXT.note }).click({ timeout: remaining(deadline) });
        await page.getByLabel("Note content", { exact: true }).fill("Edited offline");
        await page.getByRole("button", { name: "Save", exact: true }).click({ timeout: remaining(deadline) });
        await visible(page.getByText("Edited offline", { exact: true }), deadline);
        await visible(card(page, "Edited offline", page.getByText("Queued", { exact: true })), deadline);
      },
    },
    {
      name: "delete a note",
      async run(page, deadline) {
        const del = page.getByRole("button", { name: "Delete this note" });
        await card(page, "Edited offline", del).getByRole("button", { name: "Delete this note" }).click({ timeout: remaining(deadline) });
        await visible(page.getByText("Note deleted."), deadline);
        await page.getByText("Edited offline", { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
      },
    },
    {
      name: "restore a note from the trash",
      async run(page, deadline) {
        // The two toasts of the steps before sit over the last card, as they would under a thumb.
        for (const dismiss of await page.getByRole("button", { name: "Dismiss notification" }).all()) {
          await dismiss.click({ timeout: 500 }).catch(() => {}); // one may time out on its own meanwhile
        }
        await page.getByRole("button", { name: /^Trash/ }).click({ timeout: remaining(deadline) });
        const restore = page.getByRole("button", { name: "Restore", exact: true });
        await card(page, F.TEXT.trashedNote, restore).getByRole("button", { name: "Restore", exact: true }).click({ timeout: remaining(deadline) });
        await page.getByText(F.TEXT.trashedNote, { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
        await page.getByRole("button", { name: /^Trash/ }).click({ timeout: remaining(deadline) });
        await visible(page.getByText(F.TEXT.trashedNote, { exact: true }), deadline);
      },
    },
    {
      name: "search the notes",
      async run(page, deadline) {
        await page.getByLabel("Search notes").fill("from the suite");
        await visible(page.getByText("Offline note from the suite", { exact: true }), deadline);
        await page.getByText(F.TEXT.trashedNote, { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
        await page.getByLabel("Search notes").fill("");
      },
    },
  ],
  "/rules": [
    {
      name: "create a rule",
      async run(page, deadline) {
        await page.getByRole("button", { name: "+ New rule" }).click({ timeout: remaining(deadline) });
        await page.locator('input[name="key"]').fill("offline_rule");
        await page.locator('textarea[name="value"]').fill("Offline rule from the suite");
        await page.getByRole("button", { name: "Add rule" }).click({ timeout: remaining(deadline) });
        await visible(page.getByText("Offline rule from the suite"), deadline);
        await visible(card(page, "Offline rule from the suite", page.getByText("Queued", { exact: true })), deadline);
      },
    },
    {
      name: "edit a rule",
      async run(page, deadline) {
        await page.getByRole("button", { name: F.TEXT.rule }).click({ timeout: remaining(deadline) });
        await page.getByLabel("Rule text").fill("Edited rule offline");
        await page.getByRole("button", { name: "Save", exact: true }).click({ timeout: remaining(deadline) });
        await visible(page.getByText("Edited rule offline", { exact: true }), deadline);
      },
    },
    {
      name: "delete a rule",
      async run(page, deadline) {
        const del = page.getByRole("button", { name: "Delete this rule" });
        await card(page, "Edited rule offline", del).getByRole("button", { name: "Delete this rule" }).click({ timeout: remaining(deadline) });
        await page.getByText("Edited rule offline", { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
      },
    },
    {
      name: "show the prompt block",
      async run(page, deadline) {
        await page.getByRole("button", { name: /the prompt block/ }).click({ timeout: remaining(deadline) });
        await visible(page.getByText(/standing_rules/), deadline);
      },
    },
  ],
  "/context-builder": [
    {
      name: "run controls are online-only",
      async run(page, deadline) {
        await visible(page.getByText("Starting or stopping a run needs the connection."), deadline);
        for (const name of ["Start", "Force full", "Stop"]) {
          if (await page.getByRole("button", { name, exact: true }).isEnabled()) throw new Error(`${name} is enabled offline`);
        }
      },
    },
  ],
  "/entities": [
    {
      name: "search the entities",
      async run(page, deadline) {
        await page.getByLabel("Search entities").fill("Project");
        await page.getByLabel("Search entities").press("Enter");
        await visible(page.getByText(F.TEXT.otherEntity), deadline);
        await page.getByText(F.TEXT.entity, { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
      },
    },
    {
      name: "open an entity",
      async run(page, deadline) {
        await page.getByRole("link", { name: F.TEXT.otherEntity }).first().click({ timeout: remaining(deadline) });
        await visible(page.getByRole("heading", { name: F.TEXT.otherEntity }), deadline);
      },
    },
  ],
  "/entities/[id]": [
    {
      name: "follow a relation",
      async run(page, deadline) {
        await page.getByRole("link", { name: F.TEXT.otherEntity }).first().click({ timeout: remaining(deadline) });
        await visible(page.getByRole("heading", { name: F.TEXT.otherEntity }), deadline);
      },
    },
  ],
  "/contacts": [
    {
      name: "editing is online-only",
      async run(page, deadline) {
        await visible(page.getByText(/^Editing needs the connection/), deadline);
        const edit = page.locator('button[title="Needs the connection"]').first();
        await visible(edit, deadline);
        if (await edit.isEnabled()) throw new Error("the contact edit button is enabled offline");
      },
    },
  ],
  "/topics": [
    {
      name: "curation is online-only",
      async run(page, deadline) {
        // Disabled once the app knows it is offline, which on a blackholed cold start is the
        // probe's 3 s in; a tap before that is answered "Not sent" by the form guard.
        await visible(page.getByText(/never queued offline/), deadline);
        await page.waitForFunction(
          () => {
            const buttons = [...document.querySelectorAll<HTMLButtonElement>('form[action="?/setStatus"] button')];
            return buttons.length > 0 && buttons.every((b) => b.disabled);
          },
          null,
          { timeout: remaining(deadline) },
        );
      },
    },
  ],
};

const RETRY: Control = {
  name: "try again",
  async run(page, deadline) {
    await page.getByRole("button", { name: "Try again" }).click({ timeout: remaining(deadline) });
    // The probe answers within its own 3 s budget; the notice must still be there afterwards.
    await page.getByRole("button", { name: "Try again" }).waitFor({ state: "visible", timeout: remaining(deadline) });
  },
};

// --- lanes ---

interface Lane {
  name: string;
  mode: Exclude<Mode, "forward"> | "offline";
  routes: string[];
  /** Runs the writes, then reopens offline, reconnects and checks the flush. */
  writes: boolean;
}

function lanes(): Lane[] {
  const mirrored = [...MIRRORED_ROUTES, ...STATIC_OFFLINE_ROUTES];
  const online = Object.keys(ONLINE_ONLY);
  const all = [...mirrored, ...online];
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  // The blackhole is the slow mode by construction - every online-only page waits out a probe -
  // so its pages are spread over lanes that run side by side.
  const third = Math.ceil(online.length / 3);
  const list: Lane[] = [
    { name: "blackhole", mode: "blackhole", routes: mirrored, writes: true },
    ...[0, 1, 2].map((i) => ({ name: `blackhole-${i + 1}`, mode: "blackhole" as const, routes: online.slice(i * third, (i + 1) * third), writes: false })),
    { name: "gated", mode: "gated", routes: all, writes: true },
    { name: "refused", mode: "refused", routes: all, writes: true },
    { name: "offline", mode: "offline", routes: all, writes: true },
  ];
  return list.filter((lane) => !only || lane.mode === only);
}

async function cut(lane: Lane, proxy: LaneProxy, context: BrowserContext): Promise<void> {
  if (lane.mode === "offline") {
    // DevTools' offline: `navigator.onLine` false and every request fails at once. The proxy
    // refuses underneath, so nothing the emulation might not cover reaches the app either.
    await context.setOffline(true);
    proxy.setMode("refused");
  } else {
    proxy.setMode(lane.mode);
  }
}

async function reconnect(proxy: LaneProxy, context: BrowserContext): Promise<void> {
  await context.setOffline(false);
  proxy.setMode("forward");
}

async function runLane(browser: Awaited<ReturnType<typeof chromium.launch>>, lane: Lane, upstream: string): Promise<void> {
  const proxy = new LaneProxy(upstream);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  const pages: Page[] = [];
  const open = async () => {
    const page = await context.newPage();
    pages.push(page);
    return page;
  };

  const step = async (name: string, fn: (deadline: number) => Promise<void>, page: Page, within = DESIGNED_WITHIN_MS, designed = true) => {
    const started = performance.now();
    const deadline = started + within;
    let error: string | undefined;
    try {
      await fn(deadline);
      const bad = designed ? await undesigned(page) : null;
      if (bad) error = `shows ${bad}`;
    } catch (err) {
      error = err instanceof Error ? err.message.split("\n")[0] : String(err);
    }
    const ms = Math.round(performance.now() - started);
    if (!error && ms > within) error = `took ${ms} ms, over ${within} ms`;
    if (error) {
      mkdirSync(ARTIFACTS, { recursive: true });
      await page.screenshot({ path: join(ARTIFACTS, `${lane.name}-${results.length}.png`) }).catch(() => {});
    }
    results.push({ lane: lane.name, name, ms, error });
  };

  try {
    // Online: the worker installs (and precaches), the mirror fills from the fixture.
    let page = await open();
    await step(
      "first launch online",
      async (deadline) => {
        await page.goto(`${proxy.origin}/`, { timeout: remaining(deadline) });
        await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: remaining(deadline) });
        await visible(page.getByText(F.TEXT.personal), deadline);
      },
      page,
      30_000,
    );

    // 1. Believed online, then the network goes and the reader taps. Every page first, before
    //    anything is written: going back online between pages would flush the queue early.
    for (const id of lane.routes) {
      await reconnect(proxy, context);
      await page.goto(`${proxy.origin}/notes`);
      await page.getByRole("button", { name: "Online", exact: true }).waitFor({ timeout: 10_000 });
      await cut(lane, proxy, context);
      await step(
        `${id}: navigate while believed online`,
        async (deadline) => {
          await clickLink(page, pathFor(id));
          await visible(page.getByText(expectedText(id)), deadline);
        },
        page,
      );
    }

    // From here on the network stays cut until the lane reconnects at the end.
    for (const id of lane.routes) {
      const path = pathFor(id);
      const text = expectedText(id);

      // 2. A cold start, the worker's belief reset as if the browser had stopped it.
      await page.evaluate(() => navigator.serviceWorker.controller?.postMessage({ type: "pidra:reachability", state: "online" }));
      page = await open();
      await step(
        `${id}: cold start`,
        async (deadline) => {
          await page.goto(`${proxy.origin}${path}`, { waitUntil: "commit", timeout: remaining(deadline) });
          await visible(page.getByText(text), deadline);
          if (MIRRORED_ROUTES.has(id)) await visible(page.getByText(/^(Synced|Offline copy, synced)/), deadline);
          if (id === "/" && new URL(page.url()).pathname !== `/${F.TODAY}`) throw new Error(`/ resolved to ${page.url()}`);
        },
        page,
      );

      // 3. Its controls.
      const controls = id in ONLINE_ONLY ? [RETRY] : lane.writes ? (CONTROLS[id] ?? []) : [];
      for (const control of controls) await step(`${id}: ${control.name}`, (deadline) => control.run(page, deadline), page);
    }

    // No request, from anything, outlived its budget. Measured before anything reconnects.
    await step("no request outlived its budget", () => checkBudgets(proxy), page, 70_000);

    if (lane.writes) {
      page = await open();
      await step(
        "reopen offline: the queue survived",
        async (deadline) => {
          await page.goto(`${proxy.origin}/notes`, { waitUntil: "commit", timeout: remaining(deadline) });
          await visible(page.getByText("Offline note from the suite", { exact: true }), deadline);
          await expectQueued(page, deadline);
        },
        page,
      );

      await reconnect(proxy, context);
      page = await open();
      await step(
        "reconnect: every queued write lands once",
        async (deadline) => {
          await page.goto(`${proxy.origin}/notes`, { timeout: remaining(deadline) });
          // The app start is the flush trigger. Done when the queue is empty: the dot says only
          // "Online" once the queue has been read, and no row carries a chip.
          while (proxy.delivered.length < EXPECTED_WRITES.length && performance.now() < deadline) await Bun.sleep(50);
          await page.getByRole("button", { name: "Online", exact: true }).waitFor({ timeout: remaining(deadline) });
          await page.getByText("Queued", { exact: true }).waitFor({ state: "hidden", timeout: remaining(deadline) });
          checkDelivered(proxy);
        },
        page,
        10_000,
      );
    } else {
      // An online-only page comes back by itself once the server answers again: within the 20 s
      // probe interval. What it then shows is the server's answer, which without a database here
      // is often a genuine 500 - designed too, and not this step's question.
      const since = proxy.tracked.length;
      await reconnect(proxy, context);
      await step(
        "reconnect: the notice leaves by itself",
        async (deadline) => {
          await page
            .getByRole("heading", { name: /needs the connection$/ })
            .waitFor({ state: "hidden", timeout: remaining(deadline) })
            .catch((err: unknown) => {
              const seen = proxy.tracked.slice(since).map((t) => `${t.method} ${t.path} ${t.endedAt === null ? "pending" : "done"}`);
              throw new Error(`${err instanceof Error ? err.message.split("\n")[0] : err} after: ${seen.join(", ") || "no request"}`);
            });
        },
        page,
        25_000,
        false,
      );
    }
  } finally {
    await context.close().catch(() => {});
    proxy.stop();
  }
}

/**
 * The browser's own update check of the worker script, which it makes on navigations and on
 * `registration.update()`, and of the one module the script imports. No code of the app can hand
 * them a signal, so they are not held to a budget; what matters is that nothing waits on them,
 * which every other assertion here covers.
 */
const BROWSER_OWNED = new Set(["/service-worker.js", "/_app/env.js"]);

async function checkBudgets(proxy: LaneProxy): Promise<void> {
  const cutAt = performance.now();
  const watched = proxy.tracked.filter((t) => t.mode === "blackhole" && t.startedAt <= cutAt && !BROWSER_OWNED.has(t.path.split("?")[0]));
  // Wait until every request has either ended or passed its budget.
  for (;;) {
    const now = performance.now();
    if (watched.every((t) => t.endedAt !== null || now - t.startedAt > budgetFor(t) + SLACK_MS)) break;
    await Bun.sleep(100);
  }
  const now = performance.now();
  const over = watched
    .map((t) => ({ t, lived: (t.endedAt ?? now) - t.startedAt }))
    .filter(({ t, lived }) => lived > budgetFor(t) + SLACK_MS);
  if (over.length > 0) {
    throw new Error(over.map(({ t, lived }) => `${t.method} ${t.path} lived ${Math.round(lived)} ms (budget ${budgetFor(t)})`).join("; "));
  }
  const longest = Math.max(0, ...watched.map((t) => (t.endedAt ?? now) - t.startedAt));
  if (watched.length > 0) console.log(`  ${watched.length} swallowed requests, the longest ended after ${Math.round(longest)} ms`);
}

/** What the controls above queue, once each. */
const EXPECTED_WRITES = [
  `POST /api/feedback`,
  `POST /api/notes`,
  `PATCH /api/notes/${F.NOTE_ID}`,
  `DELETE /api/notes/${F.NOTE_ID}`,
  `POST /api/notes/${F.TRASHED_NOTE_ID}/restore`,
  `POST /api/rules`,
  `PATCH /api/rules/${F.RULE_ID}`,
  `DELETE /api/rules/${F.RULE_ID}`,
];

function checkDelivered(proxy: LaneProxy): void {
  const got = proxy.delivered.map((d) => `${d.method} ${d.path}`);
  const expected = EXPECTED_WRITES;
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const g of got) counts.set(g, (counts.get(g) ?? 0) + 1);
  for (const [write, n] of counts) if (n > 1) problems.push(`${write} sent ${n} times`);
  for (const write of expected) if (!counts.has(write)) problems.push(`${write} never sent`);
  for (const write of counts.keys()) if (!expected.includes(write)) problems.push(`unexpected ${write}`);
  // Ordered per row: an edit cannot overtake the create or the delete it belongs with.
  const order = (a: string, b: string) => got.indexOf(a) < got.indexOf(b);
  if (!order(`PATCH /api/notes/${F.NOTE_ID}`, `DELETE /api/notes/${F.NOTE_ID}`)) problems.push("note delete overtook its edit");
  if (!order(`PATCH /api/rules/${F.RULE_ID}`, `DELETE /api/rules/${F.RULE_ID}`)) problems.push("rule delete overtook its edit");
  const rating = proxy.delivered.find((d) => d.path === "/api/feedback")?.body as { extraction_id?: string; signal?: string } | undefined;
  // The report's + and the detail page's − on the same extraction collapse to the last one.
  if (rating && (rating.extraction_id !== F.EXTRACTION.personal || rating.signal !== "-1")) problems.push(`rating sent as ${JSON.stringify(rating)}`);
  const note = proxy.delivered.find((d) => d.method === "POST" && d.path === "/api/notes")?.body as { id?: string; content?: string } | undefined;
  if (note && (!note.id || note.content !== "Offline note from the suite")) problems.push(`note create sent as ${JSON.stringify(note)}`);
  if (problems.length > 0) throw new Error(`${problems.join("; ")} (got: ${got.join(", ")})`);
}

// --- main ---

function chromePath(): string {
  const found = [process.env.PIDRA_CHROME, Bun.which("google-chrome"), Bun.which("google-chrome-stable"), Bun.which("chromium")].find(Boolean);
  if (!found) {
    console.error("blackhole: no Chrome found. Set PIDRA_CHROME to a Chrome or Chromium binary.");
    process.exit(1);
  }
  return found;
}

async function startServer(): Promise<{ url: string; stop: () => void }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const server = Bun.spawn(["bun", "build/index.js"], {
    cwd: DASHBOARD,
    env: {
      PATH: process.env.PATH ?? "",
      HOST: "127.0.0.1",
      PORT: String(port),
      // A closed port: the fixture stands in for everything the suite reads, and nothing may write.
      DATABASE_URL: "postgres://blackhole@127.0.0.1:1/none",
      SKILLS_BRIDGE_URL: "http://127.0.0.1:1",
      CONTEXT_BUILDER_OUTPUT_DIR: join(ARTIFACTS, "none"),
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${url}/api/health`).then((r) => r.ok, () => false)) return { url, stop: () => server.kill() };
    await Bun.sleep(100);
  }
  server.kill();
  throw new Error("the dashboard build did not start");
}

if (!args.includes("--no-build")) {
  const build = await $`bun run build`.cwd(DASHBOARD).quiet().nothrow();
  if (build.exitCode !== 0) {
    console.error(build.stderr.toString() || build.stdout.toString());
    process.exit(1);
  }
}

const started = performance.now();
const server = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  await Promise.all(lanes().map((lane) => runLane(browser, lane, server.url)));
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => r.error);
const byLane = Map.groupBy(results, (r) => r.lane);
for (const [lane, list] of byLane) {
  const slowest = list.filter((r) => !r.name.startsWith("first launch") && !r.name.startsWith("no request") && !r.name.startsWith("reconnect")).sort((a, b) => b.ms - a.ms)[0];
  console.log(`${lane}: ${list.length - list.filter((r) => r.error).length}/${list.length} passed${slowest ? `, slowest ${slowest.ms} ms (${slowest.name})` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nblackhole: ${failed.length} failure(s)`);
  for (const r of failed) console.error(`  [${r.lane}] ${r.name}: ${r.error} (${r.ms} ms)`);
  console.error(`\nScreenshots: ${ARTIFACTS}`);
  process.exit(1);
}
console.log(`blackhole: every page and control reached a designed state within ${DESIGNED_WITHIN_MS} ms in every mode, no request outlived its budget (${Math.round((performance.now() - started) / 1000)} s)`);
