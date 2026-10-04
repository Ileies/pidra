import { SKILLS_BRIDGE_URL } from "$app/env/private";
import { fail, type ActionFailure } from "@sveltejs/kit";
import { errMessage } from "$pipeline/util/text";

/**
 * The skills bridge: loopback-only, always on the host that runs the dashboard. Every write that
 * must go through `executeSkill()` or a `src/**` store is forwarded here, so the dashboard never
 * writes those tables itself.
 */
export const API = SKILLS_BRIDGE_URL;

export function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, init);
}

/** A POST init carrying a JSON body (`{}` when there is none). */
export function jsonPost(body?: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

/** What a dead bridge looks like to the person using the page. */
export function unreachableMessage(err?: unknown): string {
  return err === undefined
    ? `The skills bridge is not reachable (${API}).`
    : `The skills bridge is not reachable (${API}): ${errMessage(err)}`;
}

export interface ProxyOptions {
  /** Upstream headers to copy onto the response, besides Content-Type. */
  copyHeaders?: string[];
  /** Fixed response headers. */
  headers?: Record<string, string>;
  /** Pass the upstream body through as a stream instead of buffering it. */
  stream?: boolean;
}

/**
 * Forward a request to the bridge and hand back its answer unchanged. For `+server.ts` routes: a
 * dead bridge is a 502 naming the target, not a generic fetch error in a toast.
 */
export async function bridgeProxy(path: string, init: RequestInit = {}, options: ProxyOptions = {}): Promise<Response> {
  try {
    const res = await bridgeFetch(path, init);
    const headers = new Headers(options.headers);
    for (const name of ["Content-Type", ...(options.copyHeaders ?? [])]) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return new Response(options.stream ? res.body : await res.text(), { status: res.status, headers });
  } catch (err) {
    return Response.json({ error: unreachableMessage(err) }, { status: 502 });
  }
}

/**
 * Call the bridge from a form action. A non-2xx answer becomes `fail(status, { error })` with the
 * bridge's own message, a dead bridge `fail(503)`. `extra` is merged into the failure data (the
 * row id a list page needs to put the error on the right row).
 */
export async function bridgeAction<Body, Result, Extra extends Record<string, unknown> = {}>(
  path: string,
  init: RequestInit,
  onOk: (body: Body) => Result,
  extra?: Extra,
): Promise<Result | ActionFailure<{ error: string } & Extra>> {
  try {
    const res = await bridgeFetch(path, init);
    const body = (await res.json().catch(() => ({}))) as Body;
    if (!res.ok) return fail(res.status, { ...extra, error: (body as { error?: string }).error ?? "The skills bridge returned an error." } as { error: string } & Extra);
    return onOk(body);
  } catch (err) {
    return fail(503, { ...extra, error: unreachableMessage(err) } as { error: string } & Extra);
  }
}
