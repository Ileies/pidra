import { resolve } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SveltePlugin } from "bun-plugin-svelte";

/**
 * Registered once via `bunfig.toml`'s preload, before any test file's module-level Svelte
 * component imports run - Svelte 5 reads `document` at module init, so a per-test setup would be
 * too late.
 */
GlobalRegistrator.register();

/** The offline mirror and outbox run against `indexedDB`, which happy-dom does not implement. */
await import("fake-indexeddb/auto");

/**
 * Without this, Bun's default `.svelte` loader (used for `bun run dev`'s SSR path) generates
 * server components that render to a string, not to the DOM `@testing-library/svelte` mounts
 * against. `forceSide: "client"` is needed because the plugin only infers the side from a
 * `Bun.build` target, which `bun test` never sets.
 */
Bun.plugin(SveltePlugin({ forceSide: "client" }));

/**
 * `$app/*` only resolves inside a real SvelteKit app - Vite's SvelteKit plugin generates those
 * modules, and Bun's loader never sees them. A page under test also pulls in singletons (the
 * offline mirror state, the assistant widget) that talk to IndexedDB or the network, neither of
 * which exists in this DOM. Both get a stub here instead of a real import.
 *
 * `onResolve` can't redirect these: Bun only offers a bare specifier (no "." or ":", e.g.
 * "$app/forms") to plugins at all through `builder.module()`, an exact-match virtual-module
 * registration, never through `onResolve`'s filter-based matching - so everything here goes
 * through `builder.module()` for consistency, including the "#lib/..." specifiers that could
 * technically use either. Add an entry here (and a file under `mocks/`) the first time a page
 * under test needs another module this can't run for real.
 */
const MODULE_STUBS: Record<string, string> = {
  "$app/forms": resolve(import.meta.dir, "mocks/app-forms.ts"),
  "$app/state": resolve(import.meta.dir, "mocks/app-state.ts"),
  "$app/env": resolve(import.meta.dir, "mocks/app-env.ts"),
  "$app/navigation": resolve(import.meta.dir, "mocks/app-navigation.ts"),
  "#lib/offline/state.svelte.js": resolve(import.meta.dir, "mocks/offline-state.ts"),
  "#lib/offline/sync.js": resolve(import.meta.dir, "mocks/offline-sync.ts"),
  "#lib/assistant/state.svelte.js": resolve(import.meta.dir, "mocks/assistant-state.ts"),
};

Bun.plugin({
  name: "sveltekit-app-module-stubs",
  async setup(builder) {
    for (const [specifier, stubPath] of Object.entries(MODULE_STUBS)) {
      const exports = await import(stubPath);
      builder.module(specifier, () => ({ exports, loader: "object" }));
    }
  },
});
