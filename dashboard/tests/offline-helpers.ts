import * as db from "../src/lib/offline/db.js";
import type { Intent, IntentKind } from "../src/lib/offline/intents.js";
import type { NoteRow } from "../src/lib/notes/api.js";

export async function resetDb(): Promise<void> {
  for (const store of db.STORES) await db.clear(store);
}

export interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export type Handler = (call: Call) => Response | Promise<Response>;

/** Replaces the global `fetch` (which `net()` falls through to outside a browser) for one test. */
export function stubFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      // Read as given: happy-dom's `Headers` drops names a browser would not let a page set.
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

export const ok = (body: unknown = {}): Response => Response.json(body);
export const status = (code: number, body = ""): Response => new Response(body, { status: code });

export function intent(kind: IntentKind, payload: Record<string, unknown>, seq: number, extra: Partial<Intent> = {}): Intent {
  return { id: `intent-${seq}`, seq, kind, payload, createdAt: `2026-10-04T10:00:0${seq}.000Z`, attempts: 0, lastError: null, ...extra };
}

export function note(id: string, extra: Partial<NoteRow> = {}): NoteRow {
  return {
    id, content: `note ${id}`, scope: "global",
    created_at: "2026-10-01T08:00:00.000Z", updated_at: null, expires_at: null,
    created_by: "user", updated_by: null, deleted_at: null, revision_count: 0,
    ...extra,
  };
}

export async function queue(...intents: Intent[]): Promise<void> {
  await db.bulkPut("outbox", intents);
}

export async function ids(store: db.Store): Promise<string[]> {
  return (await db.getAll<db.Keyed>(store)).map((row) => row.id).sort();
}

export function snapshot(
  stores: Partial<Record<db.MirrorStore, db.Keyed[]>>,
  options: { etag?: string; version?: string; mode?: "full" | "delta"; base?: string | null; ids?: Partial<Record<db.MirrorStore, string[]>> } = {},
): unknown {
  return {
    version: options.version ?? "v1",
    etag: options.etag ?? "etag-1",
    mode: options.mode ?? "full",
    base: options.base ?? null,
    generatedAt: "2026-10-04T10:00:00.000Z",
    stores,
    ids: options.ids ?? Object.fromEntries(Object.entries(stores).map(([store, rows]) => [store, rows.map((row) => row.id)])),
  };
}
