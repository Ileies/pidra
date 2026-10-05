/**
 * Graceful shutdown for the long-lived streams adapter-node cannot close on its own.
 *
 * adapter-node closes only *idle* connections on SIGTERM. The assistant's SSE proxy holds a client
 * connection plus an outbound fetch to the skills bridge for a whole turn, which kept the loop
 * alive until systemd SIGKILLed after 90 s. So registered streams are ended here at once with one
 * `error` frame the widget renders, and the exit is backstopped. Installed from `hooks.server.ts`;
 * streams register via `registerStream` (see below). Ordering is deliberate:
 *
 *   0 s   this handler ends every registered stream and aborts its upstream fetch
 *   3 s   EXIT_GRACE_MS - hard exit, unless the loop already drained and the process left earlier
 *   5 s   adapter-node's own SHUTDOWN_TIMEOUT (set in `hosts/pronix/pidra.nix`)
 *  15 s   systemd's TimeoutStopSec, i.e. SIGKILL
 *
 * Each number has to be smaller than the next or the one after it is what actually ends the
 * process. Change one and read `pidra.nix` alongside it.
 */

/** Ends one in-flight stream. Called once, with the process on its way out. */
export type StreamCloser = () => void;

/**
 * Long enough for an ordinary page request to finish, short enough that a redeploy does not
 * notice. The timer is unref'd, so a process whose loop has already drained exits before it.
 */
const EXIT_GRACE_MS = 3_000;

const open = new Set<StreamCloser>();
let shuttingDown = false;
let installed = false;

/** Whether a signal has arrived. New turns are refused after that rather than cut off mid-way. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Register a stream to be closed on shutdown. Returns the unregister function, which every caller
 * must run when its stream ends on its own - otherwise the set grows for the life of the process.
 * Registering during shutdown closes immediately, because the signal has already been handled.
 */
export function registerStream(close: StreamCloser): () => void {
  if (shuttingDown) {
    close();
    return () => {};
  }

  open.add(close);
  return () => open.delete(close);
}

/**
 * Install the signal handlers (once, from `hooks.server.ts`). adapter-node's own handlers stay in
 * place; these only end the streams adapter-node cannot know about.
 */
export function installShutdownHandlers(): void {
  if (installed) return;
  installed = true;

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;

      for (const close of open) {
        try {
          close();
        } catch {
          // A stream that fails to close cleanly must not stop the others from closing.
        }
      }
      open.clear();

      setTimeout(() => process.exit(0), EXIT_GRACE_MS).unref();
    });
  }
}
