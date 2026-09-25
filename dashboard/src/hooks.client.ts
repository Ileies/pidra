import type { ClientInit, HandleClientError } from "@sveltejs/kit/hooks";
import { adoptWorkerHint, guardKitFetch, NetError, probe } from "#lib/offline/net.js";

/**
 * Runs before the first navigation (SvelteKit awaits it in `_start`), which is what makes it the
 * place for both: the fetch guard has to be installed before the root layout's load asks for
 * anything, and the worker's hint has to land before the first page decides between the network
 * and the mirror. The probe is started, not awaited - the loads already share it through `net()`.
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
      status: error.kind === "offline" ? 503 : error.kind === "slow" ? 504 : 502,
      message: error.message,
      offline: error.kind === "offline",
    };
  }
};
