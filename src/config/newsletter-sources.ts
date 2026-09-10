import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface NewsletterConfig {
  /** Sender domain (or any of its subdomains) -> display name. */
  domains: Record<string, string>;
  /** Exact sender address -> display name. Takes precedence over a domain match. */
  addresses: Record<string, string>;
}

let _config: NewsletterConfig | null = null;

/**
 * Loads newsletter source configuration from newsletter-sources.json.
 *
 * Resolved relative to this module, not process.cwd(), so it works whichever directory the
 * pipeline, the dashboard's server routes or a one-off script is launched from.
 */
export function loadNewsletterConfig(): NewsletterConfig {
  if (_config) return _config;

  const configPath = resolve(import.meta.dir, "newsletter-sources.json");
  const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<NewsletterConfig>;

  const clean = (entries: Record<string, string> | undefined): Record<string, string> =>
    Object.fromEntries(
      Object.entries(entries ?? {}).map(([key, name]) => [key.trim().toLowerCase(), name]),
    );

  _config = { domains: clean(raw.domains), addresses: clean(raw.addresses) };
  return _config;
}
