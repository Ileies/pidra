import type { PageServerLoad, Actions } from "./$types";
import { fail } from "@sveltejs/kit";

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const load: PageServerLoad = async () => {
  const res = await fetch(`${API}/api/prompts`);
  const prompts: {
    id: string;
    section: string;
    version: number;
    promptText: string;
    changeSummary: string | null;
    active: boolean;
    approvedAt: string | null;
    createdAt: string;
  }[] = res.ok ? await res.json() : [];

  // Group by section
  const sections = new Map<string, typeof prompts>();
  for (const p of prompts) {
    const arr = sections.get(p.section) ?? [];
    arr.push(p);
    sections.set(p.section, arr);
  }

  return { sections: Object.fromEntries(sections) };
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
