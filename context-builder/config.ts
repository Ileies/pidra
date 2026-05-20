import { resolve } from "node:path";
import { loadEmailAccounts, type EmailAccount } from "../src/config/email-accounts";

export type { EmailAccount };

export interface Config {
  emailAccounts: EmailAccount[];
  emailYears: number;
  githubToken: string | null;
  ollamaModel: string;
  openaiModel: string;
  outputDir: string;
}

export function loadConfig(): Config {
  return {
    emailAccounts: loadEmailAccounts(),
    emailYears: Number(process.env.CONTEXT_BUILDER_EMAIL_YEARS ?? 3),
    githubToken: process.env.GITHUB_TOKEN ?? null,
    ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:14b",
    openaiModel: process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-4o",
    outputDir: resolve(import.meta.dir, "output"),
  };
}
