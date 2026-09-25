import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { createRuleChecked, updateRule, deleteRule, RuleError } from "#lib/server/rules.js";

/**
 * Actions only, and now the no-JS fallback: the page's own writes go through the offline outbox
 * (`/api/rules`), which needs a real network round trip and so cannot be a form action. Both
 * paths call the same functions in `#lib/server/rules.js`, so they cannot drift.
 *
 * The read side moved to `+page.ts`; see `[date]/+page.server.ts` for why a
 * co-located `load` here would never run for a client-side navigation now.
 */

function ruleError(err: unknown) {
  if (err instanceof RuleError) return fail(err.message.includes("already exists") ? 409 : 400, { error: err.message });
  throw err;
}

export const actions: Actions = {
  create: async ({ request }) => {
    const data = await request.formData();
    try {
      const { key } = await createRuleChecked(
        (data.get("key") as string | null) ?? "",
        (data.get("value") as string | null) ?? "",
      );
      return { ok: true, message: `Added "${key}".` };
    } catch (err) {
      return ruleError(err);
    }
  },

  update: async ({ request }) => {
    const data = await request.formData();
    const id = (data.get("id") as string | null)?.trim();
    if (!id) return fail(400, { error: "Missing rule id" });

    try {
      await updateRule(id, (data.get("value") as string | null) ?? "");
      return { ok: true, message: "Rule updated." };
    } catch (err) {
      return ruleError(err);
    }
  },

  delete: async ({ request }) => {
    const data = await request.formData();
    const id = (data.get("id") as string | null)?.trim();
    if (!id) return fail(400, { error: "Missing rule id" });

    await deleteRule(id);
    return { ok: true, message: "Rule deleted." };
  },
};
