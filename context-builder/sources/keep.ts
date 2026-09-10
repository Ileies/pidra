import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { logError } from "../errors";

export interface KeepNote {
  id: string;
  title: string;
  text: string;
  labels: string[];
  isPinned: boolean;
  isArchived: boolean;
  updatedAt: string;
}

/**
 * Keep labels whose notes must never leave this machine - they hold passwords, card and bank
 * details, and identity-document numbers. Filtering here, at the source, is deliberate: it is
 * the single choke point every consumer goes through, so no extraction, synthesis or DB-seeding
 * path can reach a cloud API with this content even if one is added later.
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

export async function fetchKeepNotes(): Promise<KeepNote[]> {
  const all = await fetchAllKeepNotes();
  const kept = all.filter((n) => !isExcluded(n));
  const excluded = all.length - kept.length;
  if (excluded > 0) {
    process.stderr.write(
      `[keep] Withheld ${excluded} note(s) labelled ${[...EXCLUDED_LABELS].join("/")} - never sent off-machine\n`,
    );
  }
  return kept;
}

async function fetchAllKeepNotes(): Promise<KeepNote[]> {
  const scriptPath = resolve(import.meta.dir, "../scripts/keep-fetch.py");
  // gkeepapi isn't packaged in nixpkgs - see context-builder/README.md for the venv setup.
  const venvPython = resolve(import.meta.dir, "../.venv/bin/python3");
  const pythonBin = existsSync(venvPython) ? venvPython : "python3";

  return new Promise((resolve_, reject) => {
    const proc = spawn(pythonBin, [scriptPath], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code !== 0) {
        logError("keep", `Python exited with code ${code}: ${stderr}`).catch(() => {});
        return resolve_([]);
      }
      try {
        const notes = JSON.parse(stdout) as KeepNote[];
        resolve_(notes);
      } catch (err) {
        logError("keep", `Failed to parse Keep output: ${err}`).catch(() => {});
        resolve_([]);
      }
    });

    proc.on("error", (err) => {
      logError("keep", err).catch(() => {});
      resolve_([]);
    });
  });
}
