import type { PageServerLoad, Actions } from "./$types";
import { error, fail } from "@sveltejs/kit";

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
  let versionsRes: Response;
  let effectiveRes: Response;
  try {
    [versionsRes, effectiveRes] = await Promise.all([
      fetch(`${API}/api/prompts`, { signal: AbortSignal.timeout(5_000) }),
      fetch(`${API}/api/prompts/effective`, { signal: AbortSignal.timeout(5_000) }),
    ]);
  } catch {
    return { sections: [], serverOffline: true };
  }

  if (!versionsRes.ok || !effectiveRes.ok) {
    if ([versionsRes.status, effectiveRes.status].some((status) => status === 502 || status === 503 || status === 504)) {
      return { sections: [], serverOffline: true };
    }
    throw error(502, "The pipeline server could not load prompt versions.");
  }

  const prompts: PromptVersionRow[] = await versionsRes.json();
  const effective: EffectivePrompt[] = await effectiveRes.json();

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

  return { sections, serverOffline: false };
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
