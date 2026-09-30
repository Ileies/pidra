/**
 * Stub for `$app/forms`, which only resolves inside a real SvelteKit app (Vite's SvelteKit
 * plugin generates it). None of these tests submit a form - they only assert the lazy-reveal
 * cap - so a no-op action is enough; a test that needs a real submit should mock this itself.
 */

export function enhance() {
  return { destroy() {} };
}

export type SubmitFunction = (...args: unknown[]) => unknown;
