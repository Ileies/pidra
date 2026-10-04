import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { bridgeAction, jsonPost } from "#lib/server/bridge.js";

/**
 * The sender directory's one write (D7). The read side moved to `+page.ts`.
 *
 * Editing goes through the bridge's correction endpoint rather than writing the row here: a
 * contact row is harvested context, so the same rules apply as to the assistant's own edits -
 * field-level merge, `previous_state` snapshot, row locked against a re-seed. That is also why it
 * stays online-only and never enters the offline outbox: replayed days later
 * against a row that may have moved, a locking merge is the one write where a stale base does
 * lasting damage.
 */

const EDITABLE = ["name", "relationship", "priority", "contextNotes"] as const;
const PRIORITIES = ["critical", "high", "normal", "low"];

export const actions: Actions = {
  update: async ({ request }) => {
    const data = await request.formData();
    const identifier = (data.get("identifier") as string | null)?.trim();
    if (!identifier) return fail(400, { error: "Missing contact identifier" });

    const fields: Record<string, string | null> = {};
    for (const key of EDITABLE) {
      const raw = data.get(key);
      if (raw === null) continue;
      const value = String(raw).trim();
      fields[key] = value === "" ? null : value;
    }

    if (fields.priority && !PRIORITIES.includes(fields.priority)) {
      return fail(400, { error: "Invalid priority" });
    }

    const statement =
      (data.get("statement") as string | null)?.trim() ||
      `${identifier} is ${fields.name ?? "unnamed"}${fields.relationship ? `, ${fields.relationship}` : ""}.`;

    return bridgeAction(
      "/api/context/corrections",
      jsonPost({ target_kind: "contact", target_key: identifier, operation: "amend", statement, fields, source: "dashboard" }),
      (body: { applied?: string }) => ({ ok: true, message: body.applied ?? "Contact updated." }),
    );
  },
};
