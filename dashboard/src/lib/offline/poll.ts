/**
 * A polling loop that cannot pile up. `setInterval` over a blackhole
 * starts a new request every tick while the earlier ones are still waiting; this schedules the
 * next tick only after the previous one settled, and pauses entirely while the page is hidden or
 * the app is offline, resuming by itself when either comes back.
 *
 * `tick` is expected to go through `net()`, so a single tick is bounded as well. Returns a stop
 * function for `onDestroy` or an effect's cleanup.
 */

import { onReachability, reachability } from "./net.js";

export function poll(tick: () => unknown, intervalMs: number, options: { immediate?: boolean } = {}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;

  const paused = () => document.hidden || reachability() === "offline";

  async function run() {
    timer = undefined;
    if (stopped || running) return;
    if (paused()) return; // resumed by the listeners below
    running = true;
    try {
      await tick();
    } catch {
      // A failed tick is retried by the next one.
    } finally {
      running = false;
    }
    schedule();
  }

  function schedule() {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(run, intervalMs);
  }

  function resume() {
    if (stopped || paused() || running || timer !== undefined) return;
    void run();
  }

  const unsubscribe = onReachability(resume);
  document.addEventListener("visibilitychange", resume);

  if (options.immediate) void run();
  else schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", resume);
  };
}
