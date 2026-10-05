/**
 * Shared by the worker's modules (`cache.ts`, `sync.ts`, `push.ts`): its reachability flag and the
 * bounded request. Every worker request is *aborted* at its budget, not just no longer awaited.
 */

export const ASSET_BUDGET_MS = 10_000;

/**
 * What the worker believes about reachability. Sticky on purpose: it is set by a navigation that
 * got no answer and cleared by one that did, or by the page (`net.ts` posts every change), so a
 * page that boots from the shell can ask for it and go straight to the mirror.
 */
export const reach = { offline: false };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A worker request, aborted when its budget runs out. `withBudget()` alone only stops waiting; the
 * socket stayed open 11-24 s and a few of those exhaust the HTTP/1.1 per-host pool, so the page's
 * own probe queued behind them (found by scripts/blackhole). The timer is deliberately never
 * cleared: it also covers a body stalling after the headers, and aborting a finished request is a no-op.
 */
export function send(request: Request, ms: number): Promise<Response> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  // A navigation request cannot be passed to `fetch` together with an init, so it is rebuilt from
  // its parts; `redirect: "manual"` is what a navigation has, and what it must get back.
  if (request.mode === "navigate") {
    return fetch(request.url, { headers: request.headers, credentials: request.credentials, redirect: "manual", signal: controller.signal });
  }
  return fetch(request, { signal: controller.signal });
}

export function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("budget exceeded")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
