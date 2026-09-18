import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { upsertRuleByKey, RuleError } from "#lib/server/rules.js";

/**
 * The offline outbox's create (OFFLINE_PLAN.md §6). Upsert-on-key rather than the interactive
 * `?/create` action's 409-on-collision: a queued create is replayed by key, and if an earlier
 * attempt's response never reached the client, replaying it again must land on the same row
 * rather than fail. `/rules`'s own "add rule" form keeps the stricter check.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { key?: string; value?: string };

  try {
    const { id, key } = await upsertRuleByKey(body.key ?? "", body.value ?? "");
    return json({ id, key }, { status: 201 });
  } catch (err) {
    if (err instanceof RuleError) return json({ error: err.message }, { status: 400 });
    throw err;
  }
};
