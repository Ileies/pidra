import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { PROMPT_SECTIONS, resolvePromptRows, type EffectivePrompt } from "$pipeline/ai/prompt-catalog";

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

interface PromptVersionRow {
  id: string;
  section: string;
  version: number;
  promptText: string;
  changeSummary: string | null;
  active: boolean;
  approvedAt: string | null;
  createdAt: string;
}

interface SectionGroup {
  section: string;
  /** null for a row whose section the pipeline never reads. */
  effective: EffectivePrompt | null;
  versions: PromptVersionRow[];
}

export const load: PageServerLoad = async () => {
  const prompts = await sql()`
    SELECT id, section, version, prompt_text AS "promptText",
           change_summary AS "changeSummary", active,
           approved_at::text AS "approvedAt", created_at::text AS "createdAt"
    FROM prompt_versions
    ORDER BY created_at DESC
  ` as unknown as PromptVersionRow[];
  const resolved = resolvePromptRows(prompts.filter((prompt) => prompt.active).reverse());
  const effective: EffectivePrompt[] = PROMPT_SECTIONS.map((section) => resolved[section]);

  const versionsBySection = new Map<string, PromptVersionRow[]>();
  for (const p of prompts) {
    const arr = versionsBySection.get(p.section) ?? [];
    arr.push(p);
    versionsBySection.set(p.section, arr);
  }

  // The effective list is the pipeline's own section order and is complete, so it drives the
  // page: a section with no versions still gets a card saying the code baseline is in use.
  const sections: SectionGroup[] = effective.map((e) => ({
    section: e.section,
    effective: e,
    versions: versionsBySection.get(e.section) ?? [],
  }));

  // Rows the pipeline does not know about (free-text section, e.g. written by hand) would
  // otherwise be invisible. Show them, flagged as unused.
  const known = new Set<string>(effective.map((e) => e.section));
  for (const [section, versions] of versionsBySection) {
    if (!known.has(section)) sections.push({ section, effective: null, versions });
  }

  // Exactly what the notes_personal key looks like where it lands in the Section 2 payload: the
  // live personal and global notes, which is also where the standing rules from Keep now sit.
  const personal = await sql()`
    SELECT content FROM notes
    WHERE deleted_at IS NULL AND scope IN ('personal', 'global')
      AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
    ORDER BY created_at
  ` as unknown as { content: string }[];
  const personalNotesBlock = personal.length === 0
    ? "notes_personal: []"
    : `notes_personal: [\n${personal.map((note) => `  ${JSON.stringify(note.content)}`).join(",\n")}\n]`;

  return { sections, personalNotesBlock };
};

export const actions: Actions = {
  approve: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id") as string | null;
    if (!id) return fail(400, { error: "id required" });

    let res: Response;
    try {
      res = await fetch(`${API}/api/prompts/${id}/approve`, { method: "POST" });
    } catch {
      return fail(503, { error: "Pipeline server is offline." });
    }
    if (!res.ok) return fail(res.status, { error: "API error" });
    return { approved: true };
  },

  delete: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id") as string | null;
    if (!id) return fail(400, { error: "id required" });

    let res: Response;
    try {
      res = await fetch(`${API}/api/prompts/${id}`, { method: "DELETE" });
    } catch {
      return fail(503, { error: "Pipeline server is offline." });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return fail(res.status, { error: body.error ?? "API error" });
    }
    return { deleted: true };
  },
};
