import type { ClientInit, HandleClientError } from "@sveltejs/kit/hooks";
import { adoptWorkerHint, guardKitFetch, NetError, probe, statusOf } from "#lib/offline/net.js";

/**
 * Runs before the first navigation. The fetch guard must be installed before the root layout's
 * load fetches anything, and the worker's reachability hint must land before the first page
 * chooses network or mirror. The probe is started, not awaited (loads share it via `net()`).
 * See `lib/offline/net.ts`.
 */
export const init: ClientInit = async () => {
  guardKitFetch();
  await adoptWorkerHint();
  void probe();
};

/**
 * A load that failed because the network did not answer is not a 500. Anything thrown by `net()`
 * becomes an error `+error.svelte` can recognise; every other error keeps SvelteKit's default.
 */
export const handleError: HandleClientError = ({ error }) => {
  if (error instanceof NetError) {
    return {
      status: statusOf(error.kind),
      message: error.message,
      offline: error.kind === "offline",
    };
  }
};
