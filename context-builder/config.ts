import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { EXTRACTION_MODEL, SYNTHESIS_MODEL } from "../src/ai/models";
import { loadEmailAccounts, type EmailAccount } from "../src/config/email-accounts";

export type { EmailAccount };

/** Per-run settings from env (CONTEXT_BUILDER_EMAIL_YEARS, CONTEXT_BUILDER_OUTPUT_DIR, GITHUB_TOKEN) and the shared email_accounts table. */
export interface Config {
  emailAccounts: EmailAccount[];
  emailYears: number;
  githubToken: string | null;
  extractionModel: string;
  synthesisModel: string;
  outputDir: string;
}

/**
 * Without a token the GitHub source silently contributes nothing, which is easy to miss in a
 * run that otherwise succeeds. Fall back to the locally authenticated `gh` CLI so the portfolio
 * section is populated even when GITHUB_TOKEN was never put in .env.
 */
function resolveGithubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = spawnSync("gh", ["auth", "token"], { encoding: "utf-8", timeout: 10_000 });
    const token = out.stdout?.trim();
    return token && out.status === 0 ? token : null;
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<Config> {
  return {
    emailAccounts: await loadEmailAccounts(),
    emailYears: Number(process.env.CONTEXT_BUILDER_EMAIL_YEARS ?? 3),
    githubToken: resolveGithubToken(),
    extractionModel: EXTRACTION_MODEL,
    synthesisModel: SYNTHESIS_MODEL,
    outputDir: process.env.CONTEXT_BUILDER_OUTPUT_DIR
      ? resolve(process.env.CONTEXT_BUILDER_OUTPUT_DIR)
      : resolve(import.meta.dir, "output"),
  };
}
