import type { Actions, PageServerLoad } from "./$types";
import { error, fail } from "@sveltejs/kit";

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
  let res: Response;
  try {
    res = await fetch(`${API}/api/sources`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    return { sources: [], serverOffline: true };
  }
  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return { sources: [], serverOffline: true };
    }
    throw error(502, "The pipeline server could not load sources.");
  }
  const sources: SourceRow[] = await res.json();
  return { sources, serverOffline: false };
};

export const actions: Actions = {
  toggle: async ({ request }) => {
    const data = await request.formData();
    const sourceName = data.get("sourceName") as string;
    const isActive = data.get("isActive") === "true";
    const reason = (data.get("reason") as string) || undefined;

    if (!sourceName) return fail(400, { error: "sourceName required" });

    let res: Response;
    try {
      res = await fetch(`${API}/api/sources/${encodeURIComponent(sourceName)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive, reason }),
      });
    } catch {
      return fail(503, { error: "Pipeline server is offline." });
    }

    if (!res.ok) return fail(res.status, { error: "API error" });
    return { ok: true };
  },
};
