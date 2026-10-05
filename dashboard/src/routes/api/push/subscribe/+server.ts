import type { RequestHandler } from "./$types";
import { sql } from "#lib/server/postgres.js";
import { readJson } from "#lib/server/form.js";

// Web-push subscription registry (client: lib/push.svelte.ts). POST stores a browser's
// PushSubscription JSON (idempotent per endpoint), DELETE removes it by `{ endpoint }`.
export const POST: RequestHandler = async ({ request }) => {
  const { endpoint, keys } = await readJson<{ endpoint: string; keys: { p256dh: string; auth: string } }>(request);

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await sql()`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${endpoint}, ${keys.p256dh}, ${keys.auth})
    ON CONFLICT (endpoint) DO NOTHING
  `;

  return Response.json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
  const { endpoint } = await readJson<{ endpoint: string }>(request);

  if (!endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });

  await sql()`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;

  return Response.json({ ok: true });
};
