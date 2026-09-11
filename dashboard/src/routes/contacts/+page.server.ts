import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "$lib/db";

/**
 * The sender directory (D7).
 *
 * `contacts` answers one question: mail arrived from this address, who is that and how much
 * should triage care. It is deliberately not a social graph - the owner's actual social circle
 * lives on a dozen messaging platforms and none of them are ingested - so a six-row table is the
 * expected steady state, not a seeding bug (CLAUDE.md §8). The page says so, because the first
 * reaction to six rows is otherwise "something is broken".
 *
 * Editing goes through the bridge's correction endpoint rather than writing the row here: a
 * contact row is harvested context, so the same rules apply as to the assistant's own edits -
 * field-level merge, `previous_state` snapshot, row locked against a re-seed.
 */

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export interface ContactRow {
  id: string;
  identifier: string;
  name: string | null;
  relationship: string | null;
  priority: string;
  contextNotes: string | null;
  firstSeen: string | null;
  updatedAt: string | null;
  locked: boolean;
  /** Seeded once from the Context Builder's corpus, then owned by the live pipeline. */
  emailCount: number;
}

const EDITABLE = ["name", "relationship", "priority", "contextNotes"] as const;
const PRIORITIES = ["critical", "high", "normal", "low"];

export const load: PageServerLoad = async () => {
  const rows = await sql()`
    SELECT id, identifier, name, relationship, priority, context_notes,
           first_seen::text AS first_seen, updated_at, locked, email_count
    FROM contacts
    ORDER BY priority = 'critical' DESC, priority = 'high' DESC, email_count DESC NULLS LAST, identifier
  `;

  return {
    contacts: rows.map((row) => ({
      id: row.id as string,
      identifier: row.identifier as string,
      name: (row.name as string | null) ?? null,
      relationship: (row.relationship as string | null) ?? null,
      priority: (row.priority as string | null) ?? "normal",
      contextNotes: (row.context_notes as string | null) ?? null,
      firstSeen: (row.first_seen as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
      locked: !!row.locked,
      emailCount: (row.email_count as number | null) ?? 0,
    })) as ContactRow[],
  };
};

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

    try {
      const res = await fetch(`${API}/api/context/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_kind: "contact",
          target_key: identifier,
          operation: "amend",
          statement,
          fields,
          source: "dashboard",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; applied?: string };
      if (!res.ok) return fail(res.status, { error: body.error ?? "The skills bridge returned an error." });
      return { ok: true, message: body.applied ?? "Contact updated." };
    } catch {
      return fail(503, { error: "The skills bridge is not reachable (localhost:4000)." });
    }
  },
};
