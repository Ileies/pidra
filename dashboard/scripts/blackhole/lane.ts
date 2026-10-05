/**
 * One lane: a browser context behind its own proxy, driven through every page in one network mode.
 * Each page is navigated to while believed online, cold-started, and has its controls tapped; the
 * lane then checks request budgets and, for lanes that write, that the queue survived and flushed.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { chromium, BrowserContext, Page } from "playwright-core";
import { MIRRORED_ROUTES, STATIC_OFFLINE_ROUTES } from "../../src/lib/offline/tiers.ts";
import { ONLINE_ONLY } from "../../src/lib/offline/onlineOnly.ts";
import { LaneProxy, type Mode } from "./proxy.ts";
import * as F from "./fixture.ts";
import { ARTIFACTS, DESIGNED_WITHIN_MS, expectedText, expectQueued, pathFor, remaining, clickLink, results, undesigned, visible } from "./helpers.ts";
import { CONTROLS, EXPECTED_WRITES, RETRY } from "./steps.ts";
import { checkInternalLinks } from "./links.ts";
import { checkBudgets, checkDelivered } from "./verify.ts";

export interface Lane {
  name: string;
  mode: Exclude<Mode, "forward"> | "offline";
  routes: string[];
  /** Runs the writes, then reopens offline, reconnects and checks the flush. */
  writes: boolean;
}

export function lanes(only: string | null): Lane[] {
  const mirrored = [...MIRRORED_ROUTES, ...STATIC_OFFLINE_ROUTES];
  const online = Object.keys(ONLINE_ONLY);
  const all = [...mirrored, ...online];
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

export async function runLane(browser: Awaited<ReturnType<typeof chromium.launch>>, lane: Lane, upstream: string): Promise<void> {
  const proxy = new LaneProxy(upstream);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  // The client-side twin of `PIDRA_BLACKHOLE_TEST` (see `server.ts`): `+layout.svelte` decides
  // whether to show the navbar from this cookie alone, never from a server round trip (offline
  // pages must never wait on one), so the browser needs it set the same way a real login would -
  // must match `SESSION_UI_COOKIE` in `src/lib/server/auth.ts`.
  await context.addCookies([{ name: "pidra_ui", value: "1", url: proxy.origin }]);
  const open = () => context.newPage();

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

    if (lane.name === "gated") {
      await step(
        "content links reach their pages",
        async () => {
          const followed = await checkInternalLinks(page, proxy.origin);
          console.log(`  followed ${followed} internal content links`);
        },
        page,
        60_000,
      );
    }

    // 1. Believed online, then the network goes and the reader taps. Every page first, before
    //    anything is written: going back online between pages would flush the queue early.
    for (const id of lane.routes) {
      await reconnect(proxy, context);
      await page.goto(`${proxy.origin}/notes`);
      await page.getByRole("button", { name: "Synced", exact: true }).waitFor({ timeout: 10_000 });
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
          // The app start is the flush trigger. Done when the queue is empty: the glyph says only
          // "Synced" once the queue has been read, and no row carries a chip.
          while (proxy.delivered.length < EXPECTED_WRITES.length && performance.now() < deadline) await Bun.sleep(50);
          await page.getByRole("button", { name: "Synced", exact: true }).waitFor({ timeout: remaining(deadline) });
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
