import { spawn } from "node:child_process";
import { resolve } from "node:path";
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

export async function fetchKeepNotes(): Promise<KeepNote[]> {
  const scriptPath = resolve(import.meta.dir, "../scripts/keep-fetch.py");

  return new Promise((resolve_, reject) => {
    const proc = spawn("python3", [scriptPath], {
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
