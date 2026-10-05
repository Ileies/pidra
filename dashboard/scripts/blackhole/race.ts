/**
 * A restore made right after opening the trash must reach the screen with the trash still open.
 * The race is forced, not hoped for: a readwrite transaction on `meta` holds the reload's
 * `mirrorEmpty()` read for 800 ms, so the reload after the write is still running when the page
 * writes its filter into the URL (250 ms debounce). Pins the `shownUrl()` reading in
 * `routes/notes` and `routes/entities`: from `page.url` alone, that reload reset the filter.
 *
 *   bun run scripts/blackhole/race.ts          against the existing build/, a few seconds
 *   bun run scripts/blackhole/race.ts --fast   restore clicked at once, so the URL write lands mid-reload
 */
import { chromium } from "playwright-core";
import { LaneProxy } from "./proxy.ts";
import * as F from "./fixture.ts";
import { card, results, tap, visible } from "./helpers.ts";
import { chromePath, startServer } from "./server.ts";

type Browser = Awaited<ReturnType<typeof chromium.launch>>;

async function attempt(browser: Browser, upstream: string, fast: boolean): Promise<void> {
  const proxy = new LaneProxy(upstream);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "allow" });
  try {
    await context.addCookies([{ name: "pidra_ui", value: "1", url: proxy.origin }]);
    let page = await context.newPage();
    const deadline = performance.now() + 30_000;
    await page.goto(`${proxy.origin}/`);
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
    await visible(page.getByText(F.TEXT.personal), deadline);
    await page.goto(`${proxy.origin}/notes`);
    await page.getByRole("button", { name: "Synced", exact: true }).waitFor({ timeout: 10_000 });

    proxy.setMode("refused");
    page = await context.newPage();
    await page.goto(`${proxy.origin}/notes`, { waitUntil: "commit" });
    await visible(page.getByText(F.TEXT.note), deadline);

    await page.evaluate(
      () =>
        new Promise<void>((started) => {
          const open = indexedDB.open("pidra-offline");
          open.onsuccess = () => {
            const store = open.result.transaction("meta", "readwrite").objectStore("meta");
            const until = performance.now() + 800;
            const keepAlive = () => {
              if (performance.now() < until) store.get("lastSyncedAt").onsuccess = keepAlive;
            };
            keepAlive();
            started();
          };
        }),
    );

    if (fast) {
      await page.evaluate(
        () =>
          new Promise<void>((done) => {
            const button = (name: RegExp) => [...document.querySelectorAll("button")].find((b) => name.test(b.textContent?.trim() ?? ""));
            button(/^Trash/)?.click();
            const wait = () => {
              const restore = button(/^Restore$/);
              if (restore) {
                restore.click();
                done();
              } else requestAnimationFrame(wait);
            };
            wait();
          }),
      );
    } else {
      await tap(page.getByRole("button", { name: /^Trash/ }), deadline);
      const restore = page.getByRole("button", { name: "Restore", exact: true });
      await tap(card(page, F.TEXT.trashedNote, restore).getByRole("button", { name: "Restore", exact: true }), deadline);
    }

    // The restored note has left the trash, and the trash is still the view.
    await page.getByText(F.TEXT.trashedNote, { exact: true }).waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {
      throw new Error("the restored note is still shown 3 s after the restore (the filter was reset)");
    });
    if (new URL(page.url()).searchParams.get("view") !== "deleted") throw new Error(`the URL left the trash view: ${page.url()}`);
  } finally {
    await context.close().catch(() => {});
    proxy.stop();
  }
}

/** Pushes one result per scenario onto the shared `results`. */
export async function runRace(browser: Browser, upstream: string): Promise<void> {
  for (const fast of [false, true]) {
    const started = performance.now();
    let error: string | undefined;
    try {
      await attempt(browser, upstream, fast);
    } catch (err) {
      error = err instanceof Error ? err.message.split("\n")[0] : String(err);
    }
    results.push({ lane: "race", name: `restore from the trash while the URL is written${fast ? " (clicked at once)" : ""}`, ms: Math.round(performance.now() - started), error });
  }
}

if (import.meta.main) {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    if (process.argv.includes("--fast")) {
      await attempt(browser, server.url, true);
    } else {
      await runRace(browser, server.url);
      const failed = results.filter((r) => r.error);
      for (const r of failed) console.error(`race: ${r.name}: ${r.error}`);
      if (failed.length > 0) process.exitCode = 1;
    }
  } catch (err) {
    console.error(`race: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.stop();
  }
  if (!process.exitCode) console.log("race: a restore made right after opening the trash reaches the screen");
  process.exit(process.exitCode ?? 0);
}
