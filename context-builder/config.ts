import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface EmailAccount {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  isNewsAccount: boolean;
  label?: string;
}

export interface Config {
  emailAccounts: EmailAccount[];
  emailYears: number;
  githubToken: string | null;
  ollamaModel: string;
  openaiModel: string;
  outputDir: string;
}

export async function loadConfig(): Promise<Config> {
  const accountsPath = resolve(import.meta.dir, "email-accounts.json");
  let emailAccounts: EmailAccount[] = [];
  try {
    const raw = await readFile(accountsPath, "utf-8");
    emailAccounts = JSON.parse(raw);
  } catch {
    console.warn("[config] No email-accounts.json found — email source will be skipped");
  }

  return {
    emailAccounts,
    emailYears: Number(process.env.CONTEXT_BUILDER_EMAIL_YEARS ?? 3),
    githubToken: process.env.GITHUB_TOKEN ?? null,
    ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:14b",
    openaiModel: process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-4o",
    outputDir: resolve(import.meta.dir, "output"),
  };
}
