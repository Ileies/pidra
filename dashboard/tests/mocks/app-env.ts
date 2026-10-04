/**
 * Stub for `$app/env`. `browser = false` makes `net()` a plain pass-through to the global `fetch`,
 * which an offline test replaces per case instead of reproducing the reachability state machine.
 */

export const browser = false;
export const building = false;
export const dev = false;
export const version = "test";
