/** The two end-of-lane assertions: every request kept its budget, every queued write landed once. */
import { SLACK_MS } from "./helpers.ts";
import type { LaneProxy, Tracked } from "./proxy.ts";
import * as F from "./fixture.ts";
import { EXPECTED_WRITES } from "./steps.ts";

// Budgets mirror `src/lib/offline/net.ts` BUDGET and the service worker's constants; keep in sync.
const WRITE = /^\/api\/(notes(\/[^/]+(\/restore)?)?|feedback)$/;

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

/**
 * The browser's own update check of the worker script, which it makes on navigations and on
 * `registration.update()`, and of the one module the script imports. No code of the app can hand
 * them a signal, so they are not held to a budget; what matters is that nothing waits on them,
 * which every other assertion here covers. The manifest joins them for `getInstalledRelatedApps()`
 * on the settings page, which makes the browser re-fetch it with no way to abort; `InstallApp`
 * stops waiting after 3 s.
 */
const BROWSER_OWNED = new Set(["/service-worker.js", "/_app/env.js", "/manifest.webmanifest"]);

/** Waits for every request swallowed after the cut to end or pass its budget, then throws if any outlived it. */
export async function checkBudgets(proxy: LaneProxy): Promise<void> {
  const cutAt = performance.now();
  const watched = proxy.tracked.filter((t) => t.mode === "blackhole" && t.startedAt <= cutAt && !BROWSER_OWNED.has(t.path.split("?")[0]));
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

/** After reconnect: the proxy must have received exactly EXPECTED_WRITES (steps.ts), each once, with per-row ordering and the expected bodies. */
export function checkDelivered(proxy: LaneProxy): void {
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
  const rating = proxy.delivered.find((d) => d.path === "/api/feedback")?.body as { extraction_id?: string; signal?: string } | undefined;
  // The report's + and the detail page's − on the same extraction collapse to the last one.
  if (rating && (rating.extraction_id !== F.EXTRACTION.personal || rating.signal !== "-1")) problems.push(`rating sent as ${JSON.stringify(rating)}`);
  const note = proxy.delivered.find((d) => d.method === "POST" && d.path === "/api/notes")?.body as { id?: string; content?: string } | undefined;
  if (note && (!note.id || note.content !== "Offline note from the suite")) problems.push(`note create sent as ${JSON.stringify(note)}`);
  if (problems.length > 0) throw new Error(`${problems.join("; ")} (got: ${got.join(", ")})`);
}
