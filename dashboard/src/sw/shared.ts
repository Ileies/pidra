/**
 * What the worker's modules share: its belief about reachability and the bounded request.
 * Every request the worker makes is *aborted* at its budget, not just stopped being waited for.
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
 * A request this worker makes, aborted when its budget runs out (found by `scripts/blackhole`).
 * `withBudget()` alone only stops *waiting*: the request itself kept its socket until the OS gave
 * up, 11 to 24 s in the suite, and over HTTP/1.1 a handful of those take the whole per-host
 * connection pool, so the page's own probe queued behind them and the app could not even tell it
 * was back online. The timer is never cleared: the abort also covers a body that stalls after the
 * headers, and aborting a request that already finished does nothing.
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
