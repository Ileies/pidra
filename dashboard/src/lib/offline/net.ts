/**
 * The one client-side caller of `fetch` (OFFLINE_PLAN.md §14, H1), and the owner of the app's
 * belief about whether pronix is reachable. `dashboard/scripts/check-offline.ts` fails the build
 * on a bare `fetch(` anywhere else in client code.
 *
 * The failure this has to survive is not a fast error. With the VPN app up and no network under
 * it, or with wg0 down and `pidra.ileies.de` resolving to a `10.200.200.1` nobody on this network
 * answers for, a request is a blackhole: nothing ever comes back, and a bare `fetch` waits for the
 * OS connect timeout, which on a phone is well past a minute. So:
 *
 * - **Every request has a hard ceiling**, and its body is read inside it, so a caller's `.json()`
 *   cannot hang after the headers arrived either.
 * - **Slow is told apart from gone by asking, not by guessing.** A request still waiting after
 *   `SUSPECT_AFTER_MS` starts one shared probe of `/api/health`. If the probe fails, the app is
 *   offline and every request in flight is aborted at once; if it answers, pronix is only slow and
 *   the request keeps its full budget. A short timeout alone would call a slow `/runs` query
 *   "offline", and a long one leaves the phone spinning in the blackhole.
 * - **Known offline fails in the same frame.** While the state is `offline`, nothing but probes
 *   goes out: `net()` throws `NetError("offline")` at once and the caller falls back to the mirror,
 *   the outbox, or `OfflineNotice`. `state.svelte.ts` keeps probing, which is the way back.
 * - **A response the app did not write is not the app.** `hooks.server.ts` stamps `x-pidra` on
 *   every response it serves; one without it (nginx's 403 on the public path, a captive portal)
 *   means pronix was not reached.
 *
 * SvelteKit's own `__data.json` and form-action requests cannot be handed a signal, so
 * `guardKitFetch()` routes exactly those two through here as well, and bounds its version check.
 * SvelteKit reads `window.fetch` at call time for precisely this purpose (`load_data` in
 * node_modules/@sveltejs/kit/src/runtime/client/client.js, and `enhance` in .../app/forms/client.js).
 */

import { browser } from "$app/env";

export type Reachability = "checking" | "online" | "offline";

/**
 * `offline`: pronix cannot be reached. `slow`: it can, and did not answer within the budget.
 * `failed`: the transport broke although a probe right after it succeeded - rare, and retryable.
 */
export type NetErrorKind = "offline" | "slow" | "failed";

export class NetError extends Error {
  readonly kind: NetErrorKind;
  /** False when the request never left the device, which is what lets a form say "not sent". */
  readonly sent: boolean;

  constructor(kind: NetErrorKind, sent: boolean) {
    super(messageFor(kind, sent));
    this.name = "NetError";
    this.kind = kind;
    this.sent = sent;
  }
}

function messageFor(kind: NetErrorKind, sent: boolean): string {
  if (kind === "slow") return "The server took too long to answer.";
  if (kind === "failed") return "The request failed on the way. Try again.";
  return sent ? "Lost the connection before the server answered." : "Needs the connection.";
}

/** Hard ceilings. Offline is detected long before any of them, through the probe. */
export const BUDGET = {
  probe: 3_000,
  /** A tap the user is waiting on. */
  interactive: 15_000,
  /** A page's server load (`__data.json`), which is allowed to be merely slow. */
  page: 30_000,
  /** A full offline snapshot: 645 kB raw, 178 kB as nginx gzips it (measured 2026-09-25). */
  sync: 60_000,
} as const;

const SUSPECT_AFTER_MS = 500;

let state: Reachability = "checking";
const listeners = new Set<(next: Reachability) => void>();
const inFlight = new Set<AbortController>();

/** Plain call shape, without the extra members runtime typings hang off `typeof fetch`. */
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Captured before `guardKitFetch()` replaces `window.fetch`, so the guard cannot recurse into itself.
const nativeFetch: Fetcher = browser ? window.fetch.bind(window) : (input, init) => fetch(input, init);

export function reachability(): Reachability {
  return state;
}

export function onReachability(listener: (next: Reachability) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The `offline` event, or the service worker's hint at start. A free, certain negative. */
export function markOffline(): void {
  setState("offline");
}

function setState(next: Reachability): void {
  if (next === state) return;
  state = next;
  if (next === "offline") {
    for (const controller of inFlight) controller.abort(new NetError("offline", true));
    inFlight.clear();
  }
  tellWorker(next);
  for (const listener of listeners) listener(next);
}

/** The worker bounds navigations with the same belief, so the two cannot disagree for long. */
function tellWorker(next: Reachability): void {
  if (!browser || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "pidra:reachability", state: next });
}

/**
 * Asks the service worker what it already knows. When a navigation just fell back to the cached
 * shell because the network did not answer, the worker knows the app is offline before this page
 * has made a single request, and the first render can go straight to the mirror. Answers within
 * a few milliseconds; the 250 ms cap only matters if the worker is busy starting up.
 */
export async function adoptWorkerHint(): Promise<void> {
  if (!browser || !("serviceWorker" in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;

  const channel = new MessageChannel();
  const answer = new Promise<unknown>((resolve) => {
    channel.port1.onmessage = (event) => resolve(event.data?.state);
    setTimeout(() => resolve(null), 250);
  });
  controller.postMessage({ type: "pidra:reachability?" }, [channel.port2]);
  if ((await answer) === "offline" && state === "checking") setState("offline");
}

function isOurs(response: Response): boolean {
  return response.headers.has("x-pidra");
}

let probing: Promise<boolean> | null = null;

/** Liveness of the dashboard process, which is exactly what wg0 gates. Shared by all callers. */
export function probe(): Promise<boolean> {
  probing ??= runProbe().finally(() => {
    probing = null;
  });
  return probing;
}

async function runProbe(): Promise<boolean> {
  if (browser && !navigator.onLine) {
    setState("offline");
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET.probe);
  try {
    const res = await nativeFetch("/api/health", { cache: "no-store", signal: controller.signal });
    // Any answer the app wrote counts, including a 5xx: the process was reached, which is the
    // question. An answer it did not write (no stamp) was someone else's.
    const reached = isOurs(res);
    setState(reached ? "online" : "offline");
    return reached;
  } catch {
    setState("offline");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface NetOptions {
  /** Hard ceiling for the whole request, body included. Defaults to `BUDGET.interactive`. */
  budgetMs?: number;
  /**
   * Hand the response over as soon as the headers arrive and leave the body to the caller, for the
   * assistant's SSE stream. Only the wait for the headers is budgeted then.
   */
  stream?: boolean;
  /**
   * A universal load's own `fetch`, for a load that also runs during server rendering. On the
   * server `net()` is a plain pass-through to it: the server has no reachability to track, and
   * module state shared across every request must not learn "offline" from one of them.
   */
  fetch?: Fetcher;
}

export async function net(input: string | URL, init: RequestInit = {}, options: NetOptions = {}): Promise<Response> {
  if (!browser) return (options.fetch ?? fetch)(input, init);
  if (state === "offline") throw new NetError("offline", false);
  if (!navigator.onLine) {
    setState("offline");
    throw new NetError("offline", false);
  }

  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  let timedOut = false;
  const ceiling = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.budgetMs ?? BUDGET.interactive);
  const suspect = setTimeout(() => void probe(), SUSPECT_AFTER_MS);
  inFlight.add(controller);

  try {
    const res = await (options.fetch ?? nativeFetch)(input, { ...init, signal });
    if (!isOurs(res)) {
      setState("offline");
      throw new NetError("offline", true);
    }
    setState("online");
    if (options.stream) return res;
    const body = await res.arrayBuffer();
    // A 304 (the snapshot's ETag path) or 204 may not carry a body, not even an empty one: the
    // constructor throws, which would read as a transport failure.
    const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
    return new Response(nullBody ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch (err) {
    if (err instanceof NetError) throw err;
    // The caller cancelled. That says nothing about the network, so it is theirs to handle.
    if (init.signal?.aborted) throw err;
    if (timedOut) throw new NetError("slow", true);
    // A transport error. Fail-fast offline and a server that reset one connection look the same
    // here, so ask before concluding either.
    throw new NetError((await probe()) ? "failed" : "offline", true);
  } finally {
    clearTimeout(ceiling);
    clearTimeout(suspect);
    inFlight.delete(controller);
  }
}

/** The JSON body of a `net()` response, with the server's own `error` field as the message. */
export async function netJson<T>(input: string | URL, init: RequestInit = {}, options: NetOptions = {}): Promise<T> {
  const res = await net(input, init, options);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
    throw new Error("The server answered with something that is not JSON.");
  }
  if (!res.ok) {
    const message = (parsed as { error?: string } | null)?.error;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return parsed as T;
}

// --- SvelteKit's own requests ---

const STATUS: Record<NetErrorKind, number> = { offline: 503, slow: 504, failed: 502 };

/**
 * `load_data` turns a non-OK JSON response into `page.error` by spreading the body into it
 * (`client.js`, `load_data`), so `offline: true` reaches `+error.svelte` as a field of the error
 * rather than as something the page has to infer from the dot in the header.
 */
function pageDataError(err: NetError): Response {
  return Response.json({ message: err.message, offline: err.kind === "offline" }, { status: STATUS[err.kind] });
}

/**
 * A form action answered as `failure` with `{ error }` rather than as `error`: every page already
 * shows `form.error`, and a failure keeps what was typed, where an error would replace the page
 * with the error boundary and lose it. `data` is devalue's wire format for `{ error: message }`.
 */
function formActionError(err: NetError): Response {
  const message = err.sent
    ? `${err.message} It may or may not have been saved; check once the connection is back.`
    : `Not sent: ${err.message.toLowerCase()} What you entered is still here.`;
  return Response.json({ type: "failure", status: STATUS[err.kind], data: JSON.stringify([{ error: 1 }, message]) }, { status: STATUS[err.kind] });
}

/**
 * SvelteKit's `updated.check()` (`$app/state`), which every navigation that ends at a status of 400
 * or more awaits before it renders (`client.js`, after `load_route`), to see whether a deploy
 * removed the chunk it needed. Over a blackhole that request never ends, so the error page -
 * `OfflineNotice` included - never appeared. Found in H2 testing; H1's measurement predates it.
 *
 * Not through `net()`: `version.json` is a static file adapter-node serves before the hooks, so it
 * carries no `x-pidra` stamp and would read as "someone else answered". A plain bounded request
 * instead, never sent while known offline, and anything but an answer means "no update", which is
 * what `check()` does with a failed response anyway.
 */
function versionCheck(input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {
  if (state === "offline") return Promise.resolve(new Response(null, { status: 503 }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUDGET.probe);
  return nativeFetch(input, { ...init, signal: controller.signal })
    .catch(() => new Response(null, { status: 503 }))
    .finally(() => clearTimeout(timer));
}

export function guardKitFetch(): void {
  if (!browser) return;
  const guarded: Fetcher = (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    if (url.origin !== location.origin) return nativeFetch(input, init);

    if (url.pathname.endsWith("/_app/version.json")) return versionCheck(input, init);

    if (url.pathname.endsWith("/__data.json")) {
      return net(url, init, { budgetMs: BUDGET.page }).catch((err: unknown) => {
        if (err instanceof NetError) return pageDataError(err);
        throw err;
      });
    }

    const headers = new Headers(init?.headers ?? request?.headers);
    if (headers.get("x-sveltekit-action") === "true") {
      return net(url, init, { budgetMs: BUDGET.interactive }).catch((err: unknown) => {
        if (err instanceof NetError) return formActionError(err);
        throw err;
      });
    }

    return nativeFetch(input, init);
  };
  // The cast only drops runtime-specific extras from the type (Bun's `fetch.preconnect`); the
  // browser's `fetch` is exactly this call shape.
  window.fetch = guarded as typeof window.fetch;
}
