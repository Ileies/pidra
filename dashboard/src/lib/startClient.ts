import { assistant } from "#lib/assistant/state.svelte.js";
import { offline } from "#lib/offline/state.svelte.js";
import { appUpdate } from "#lib/offline/update.svelte.js";
import { pwa } from "#lib/pwa.svelte.js";
import { push } from "#lib/push.svelte.js";
import { loadTheme } from "#lib/theme.svelte.js";

let started = false;
let sessionStarted = false;

/**
 * Browser-only one-time setup, called from the root layout's effect. The two stages are the only
 * start guards: the first run is for everyone, the second only once the logged-in chrome shows
 * (login is an SPA `goto`, so the layout calls this again afterwards).
 */
export function startClient(loggedIn: boolean): void {
  if (!started) {
    started = true;
    loadTheme();
    appUpdate.start();
    pwa.start();
    void push.start();
  }
  if (loggedIn && !sessionStarted) {
    sessionStarted = true;
    offline.start();
    assistant.restore();
  }
}
