// What the dashboard's server modules need from SvelteKit, so they can run under `bun test`:
// `$app/env/private` (secrets), `$app/env`, a cookie jar and a RequestEvent-shaped object. Import
// this file, call `useTestDatabase()`, then `setPrivateEnv()` so the stub carries the cloned
// `DATABASE_URL`, all before the dashboard first imports its env.
import { mock } from "bun:test";

const privateEnv: Record<string, string | undefined> = {
  AUTH_RP_ID: "example.test",
  AUTH_ORIGIN: "https://example.test",
  AUTH_SETUP_TOKEN: "setup-token-for-tests",
  SKILLS_BRIDGE_URL: "http://bridge.test",
  CONFIG_ENCRYPTION_KEY: "ab".repeat(32),
  CONTEXT_BUILDER_OUTPUT_DIR: "context-builder/output",
};
const appEnv = { building: false, dev: false, version: "test-build" };

/** Re-registering updates the live bindings of modules that already imported the stub. */
export function setPrivateEnv(patch: Record<string, string | undefined> = {}): void {
  Object.assign(privateEnv, patch);
  mock.module("$app/env/private", () => ({ ...privateEnv, DATABASE_URL: process.env.DATABASE_URL }));
}
export function setAppEnv(patch: Partial<typeof appEnv> = {}): void {
  Object.assign(appEnv, patch);
  mock.module("$app/env", () => ({ ...appEnv }));
}
setPrivateEnv();
setAppEnv();

export interface Jar {
  get(name: string): string | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
  /** What the handler asked the browser to store, newest last. */
  sets: { name: string; value: string; options: Record<string, any> }[];
  deletes: string[];
}

export function fakeCookies(initial: Record<string, string> = {}): Jar {
  const values = new Map(Object.entries(initial));
  const jar: Jar = {
    get: (name) => values.get(name),
    set: (name, value, options) => { values.set(name, value); jar.sets.push({ name, value, options }); },
    delete: (name) => { values.delete(name); jar.deletes.push(name); },
    sets: [],
    deletes: [],
  };
  return jar;
}

interface EventInit {
  method?: string;
  path?: string;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  session?: { id: string } | null;
  ip?: string;
  params?: Record<string, string>;
}

/** A RequestEvent with the fields the dashboard handlers read; `cookies` is the jar to assert on. */
export function makeEvent(init: EventInit = {}) {
  const url = new URL(init.path ?? "/", "https://example.test");
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const request = new Request(url, {
    method: init.method ?? "POST",
    headers,
    body: init.method === "GET" ? undefined : init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const cookies = fakeCookies(init.cookies);
  return {
    request,
    url,
    cookies,
    params: init.params ?? {},
    locals: { session: init.session ?? null },
    getClientAddress: () => init.ip ?? "203.0.113.7",
    isDataRequest: false,
    route: { id: url.pathname },
  };
}
