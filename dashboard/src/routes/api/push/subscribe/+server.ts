import type { RequestHandler } from "./$types";
import { sql } from "#lib/db.js";

export const POST: RequestHandler = async ({ request }) => {
  const sub = await request.json();
  const { endpoint, keys } = sub as { endpoint: string; keys: { p256dh: string; auth: string } };

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
  const { endpoint } = await request.json() as { endpoint: string };

  if (!endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });

  await sql()`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;

  return Response.json({ ok: true });
};
