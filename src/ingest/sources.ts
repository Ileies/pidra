import { loadEmailAccounts } from "../config/email-accounts";
import type { NewsletterConfig } from "../config/newsletter-sources";

// Email addresses that are "self" - never classified as an incoming action item.
//
// The list is the union of every account in `email_accounts` and SELF_EMAILS from .env (kept out
// of source: this repository is public and these are real addresses), so addresses the pipeline
// does not read from - a work address, an alias - can be added without having to restate the
// accounts. Async because the accounts now live in Postgres; memoized like `loadEmailAccounts()`.
let _selfEmails: string[] | null = null;

export async function getSelfEmails(): Promise<string[]> {
  if (_selfEmails) return _selfEmails;
  const all = new Set<string>();

  try {
    for (const account of await loadEmailAccounts()) {
      const user = account.user.trim().toLowerCase();
      if (user.includes("@")) all.add(user);
    }
  } catch {
    // email_accounts unreachable - fall through to the env list alone.
  }

  for (const raw of (process.env.SELF_EMAILS ?? "").split(",")) {
    const email = raw.trim().toLowerCase();
    if (email.includes("@")) all.add(email);
  }

  _selfEmails = [...all];
  return _selfEmails;
}

/**
 * Decides whether a sender is a newsletter or a person.
 *
 * The source mappings are configuration, not code: they live in
 * `newsletter_sender_rules`, edited from `/settings/newsletters`.
 */
export function classifyEmail(from: string, { domains, addresses }: NewsletterConfig): { sourceType: "newsletter" | "personal_email"; sourceName: string | null } {

  const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase().trim();
  const senderDomain = senderEmail.split("@")[1] ?? "";
  const senderName = (from.match(/^([^<]+)</) ?? [])[1]?.trim() ?? "";

  // Exact address wins over a domain match.
  if (addresses[senderEmail]) {
    return { sourceType: "newsletter", sourceName: addresses[senderEmail] };
  }

  // Specific publication domains win over a generic parent such as substack.com.
  for (const [domain, name] of Object.entries(domains).sort((a, b) => b[0].length - a[0].length)) {
    if (senderDomain === domain || senderDomain.endsWith("." + domain)) {
      return { sourceType: "newsletter", sourceName: name || senderName || null };
    }
  }

  return { sourceType: "personal_email", sourceName: senderEmail };
}
