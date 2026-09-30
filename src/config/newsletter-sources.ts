import { db, newsletterSenderRules } from "../db";

export interface NewsletterConfig {
  domains: Record<string, string>;
  addresses: Record<string, string>;
}

let cached: NewsletterConfig | null = null;

/** A one-shot pipeline loads the current settings once, then uses one consistent snapshot. */
export async function loadNewsletterConfig(): Promise<NewsletterConfig> {
  if (cached) return cached;
  const rows = await db.select().from(newsletterSenderRules);
  const domains: Record<string, string> = {};
  const addresses: Record<string, string> = {};
  for (const row of rows) {
    (row.matchKind === "address" ? addresses : domains)[row.pattern] = row.sourceName;
  }
  cached = { domains, addresses };
  return cached;
}
