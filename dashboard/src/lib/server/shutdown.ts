/**
 * Graceful shutdown for the long-lived streams adapter-node cannot close on its own.
 *
 * adapter-node does handle SIGTERM, so the old "ignores SIGTERM" reading was half the story: its
 * handler closes *idle* connections, waits for the rest, and only after `SHUTDOWN_TIMEOUT` calls
 * `closeAllConnections()`. The assistant's SSE proxy is neither idle nor short. It holds a client
 * connection open for the length of a turn and an outbound fetch to the skills bridge behind it,
 * and that fetch keeps the event loop alive even once the client socket is gone - so the process
 * sat there until systemd's default 90 s stop timeout SIGKILLed it, stalling every redeploy and
 * tearing down whatever was in flight.
 *
 * The fix is to close those streams ourselves the moment the signal arrives, with one `error`
 * frame the widget already knows how to render, and to backstop the exit for the case where
 * something still holds the loop. Ordering matters and is deliberate:
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
 * Install the signal handlers. Called once from `hooks.server.ts`, which the server imports at
 * startup. adapter-node's handlers stay in place; these run alongside them and only do the part
 * adapter-node has no way to do, which is knowing that a stream is ours to end.
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
