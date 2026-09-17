import { building, dev } from "$app/env";
import { installShutdownHandlers } from "#lib/server/shutdown.js";

// SvelteKit imports this module once, when the server starts, which is the only place in the
// dashboard that runs before the first request. Dev keeps Vite's own signal handling and the
// build step must not install a process handler at all, so both are skipped.
if (!building && !dev) installShutdownHandlers();
