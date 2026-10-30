// Keep source: pulls notes through keep-api.ts (credentials from env or the token file written by
// scripts/keep-auth.ts). fetchKeepNotes is the ONLY exit for Keep content, so the label exclusion below
// holds for every consumer. Any failure is logged to errors.json and yields no notes.
import { resolve } from "node:path";
import { CONTEXT_BUILDER_DIR } from "../../src/config/data-dir";
import { logError } from "../errors";
import { syncKeepNotes, type KeepClientOptions, type KeepCredentials } from "./keep-api";
import type { KeepNote } from "./keep-tree";

export type { KeepNote } from "./keep-tree";

/** Written by scripts/keep-auth.ts as `{ email, master_token }`; the key name is kept from the Python era. */
export const KEEP_TOKEN_PATH = resolve(CONTEXT_BUILDER_DIR, ".keep-token.json");

/**
 * Labels (case-insensitive; env CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS, default "Credentials") whose
 * notes hold secrets and must never leave this machine. Filtered at the source, the single choke
 * point, so no later extraction, synthesis or seeding path can send them to a cloud API.
 */
const EXCLUDED_LABELS = new Set(
  (process.env.CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS ?? "Credentials")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean),
);

function isExcluded(note: KeepNote): boolean {
  return note.labels.some((l) => EXCLUDED_LABELS.has(l.trim().toLowerCase()));
}

/** GKEEPAPI_EMAIL + GKEEPAPI_MASTER_TOKEN win; either missing, both come from the token file. */
export async function loadKeepCredentials(): Promise<KeepCredentials> {
  const email = process.env.GKEEPAPI_EMAIL;
  const masterToken = process.env.GKEEPAPI_MASTER_TOKEN;
  if (email && masterToken) return { email, masterToken };

  const file = Bun.file(KEEP_TOKEN_PATH);
  if (!(await file.exists())) throw new Error("No Keep token found. Run context-builder/scripts/keep-auth.ts first.");
  const saved = (await file.json()) as { email?: string; master_token?: string };
  if (!saved.email || !saved.master_token) throw new Error(`${KEEP_TOKEN_PATH} lacks email or master_token`);
  return { email: saved.email, masterToken: saved.master_token };
}

/** All Keep notes minus excluded labels. Always go through this, never fetchAllKeepNotes. */
export async function fetchKeepNotes(opts?: KeepClientOptions): Promise<KeepNote[]> {
  const all = await fetchAllKeepNotes(opts);
  const kept = all.filter((n) => !isExcluded(n));
  const excluded = all.length - kept.length;
  if (excluded > 0) {
    process.stderr.write(
      `[keep] Withheld ${excluded} note(s) labelled ${[...EXCLUDED_LABELS].join("/")} - never sent off-machine\n`,
    );
  }
  return kept;
}

async function fetchAllKeepNotes(opts?: KeepClientOptions): Promise<KeepNote[]> {
  try {
    return await syncKeepNotes(await loadKeepCredentials(), opts);
  } catch (err) {
    await logError("keep", err).catch(() => {});
    return [];
  }
}
