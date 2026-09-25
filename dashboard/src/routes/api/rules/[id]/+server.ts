import type { RequestHandler } from "./$types";
import { updateRule, deleteRule, RuleError } from "#lib/server/rules.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** The offline outbox's update and delete (OFFLINE_PLAN.md §6). JSON twins of the `?/update` and
 *  `?/delete` form actions, both calling the same `#lib/server/rules.js` functions. */
export const PATCH: RequestHandler = async ({ params, request }) => {
  if (!UUID_RE.test(params.id)) return Response.json({ error: "Invalid rule id" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { value?: string };

  try {
    await updateRule(params.id, body.value ?? "");
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RuleError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  if (!UUID_RE.test(params.id)) return Response.json({ error: "Invalid rule id" }, { status: 400 });
  // Idempotent: a replayed delete against a row that is already gone is success, not a 404 -
  // the same rule notes follow.
  await deleteRule(params.id);
  return Response.json({ ok: true });
};
