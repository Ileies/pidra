/** The /notes filter as it lives in the URL, so a view is shareable and survives a reload. */
import { NARROWNESS } from "$pipeline/notes/narrowness";
import { NOTE_STEPS } from "$pipeline/notes/steps";
import type { NotesFilter } from "#lib/offline/repo.js";

const SORTS = ["newest", "oldest", "edited"] as const;
const VIEWS = ["active", "deleted", "all"] as const;

const oneOf = <T extends string>(allowed: readonly T[], value: string | null): T | undefined =>
  allowed.find((candidate) => candidate === value);

export function parseFilter(params: Pick<URLSearchParams, "get">): NotesFilter {
  return {
    scope: params.get("scope") ?? "",
    query: params.get("q") ?? "",
    sort: oneOf(SORTS, params.get("sort")) ?? "newest",
    view: oneOf(VIEWS, params.get("view")) ?? "active",
    narrowness: oneOf(NARROWNESS, params.get("narrow")) ?? "",
    step: oneOf(NOTE_STEPS, params.get("step")) ?? "",
    target: params.get("target") ?? "",
    dormant: params.get("dormant") === "1",
  };
}

/** `?...` for the non-default parts of `filter`, or "". */
export function searchOf(filter: NotesFilter): string {
  const params = new URLSearchParams();
  if (filter.scope) params.set("scope", filter.scope);
  if (filter.query.trim()) params.set("q", filter.query.trim());
  if (filter.sort !== "newest") params.set("sort", filter.sort);
  if (filter.view !== "active") params.set("view", filter.view);
  if (filter.narrowness) params.set("narrow", filter.narrowness);
  if (filter.step) params.set("step", filter.step);
  if (filter.target.trim()) params.set("target", filter.target.trim());
  if (filter.dormant) params.set("dormant", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}
