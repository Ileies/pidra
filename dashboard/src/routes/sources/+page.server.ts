import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export interface DailyScore {
  sourceName: string;
  runDate: string;
  itemsReceived: number;
  itemsIncluded: number;
  avgRelevance: number | null;
  avgEffectiveRelevance: number | null;
  includeRate: number | null;
  compositeScore: number | null;
}

export interface SourceRow {
  sourceName: string;
  isActive: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  trustScore: number | null;
  qualityTrend: string | null;
  compositeScore30d: number | null;
  dailyScores: DailyScore[];
}

export const load: PageServerLoad = async () => {
  const res = await fetch(`${API}/api/sources`);
  const sources: SourceRow[] = res.ok ? await res.json() : [];
  return { sources };
};

export const actions: Actions = {
  toggle: async ({ request }) => {
    const data = await request.formData();
    const sourceName = data.get("sourceName") as string;
    const isActive = data.get("isActive") === "true";
    const reason = (data.get("reason") as string) || undefined;

    if (!sourceName) return fail(400, { error: "sourceName required" });

    const res = await fetch(`${API}/api/sources/${encodeURIComponent(sourceName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive, reason }),
    });

    if (!res.ok) return fail(500, { error: "API error" });
    return { ok: true };
  },
};
