import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";

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

interface EffectivePrompt {
  section: string;
  text: string;
  version: number | null;
  source: "db" | "code";
}

interface SectionGroup {
  section: string;
  /** null for a row whose section the pipeline never reads. */
  effective: EffectivePrompt | null;
  versions: PromptVersionRow[];
}

export const load: PageServerLoad = async () => {
  const [versionsRes, effectiveRes] = await Promise.all([
    fetch(`${API}/api/prompts`),
    fetch(`${API}/api/prompts/effective`),
  ]);

  const prompts: PromptVersionRow[] = versionsRes.ok ? await versionsRes.json() : [];
  const effective: EffectivePrompt[] = effectiveRes.ok ? await effectiveRes.json() : [];

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
  const known = new Set(effective.map((e) => e.section));
  for (const [section, versions] of versionsBySection) {
    if (!known.has(section)) sections.push({ section, effective: null, versions });
  }

  return { sections };
};

export const actions: Actions = {
  approve: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id") as string | null;
    if (!id) return fail(400, { error: "id required" });

    const res = await fetch(`${API}/api/prompts/${id}/approve`, { method: "POST" });
    if (!res.ok) return fail(500, { error: "API error" });
    return { approved: true };
  },

  delete: async ({ request }) => {
    const data = await request.formData();
    const id = data.get("id") as string | null;
    if (!id) return fail(400, { error: "id required" });

    const res = await fetch(`${API}/api/prompts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return fail(res.status, { error: body.error ?? "API error" });
    }
    return { deleted: true };
  },
};
