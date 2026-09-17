import type { PageLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { pull } from "#lib/offline/sync.js";
import { newestMirroredDate } from "#lib/offline/repo.js";

/**
 * `/` offline resolves to the newest cached report date, not to today's (OFFLINE_PLAN.md §7). With
 * the VPN off overnight, today's briefing was never fetched; landing on an empty "no report yet"
 * page when yesterday's is in the mirror is the wrong answer. `pull()` here doubles as the
 * reachability check: reaching the snapshot endpoint is reaching the dashboard, which is exactly
 * what wg0 gates.
 */
export const ssr = false;

export const load: PageLoad = async () => {
  const today = new Date().toLocaleDateString("sv-SE");
  const outcome = await pull();
  if (outcome === "synced") redirect(307, `/${today}`);

  const newest = await newestMirroredDate();
  redirect(307, `/${newest ?? today}`);
};
