import { loadEmailAccounts } from "../config/email-accounts";
import { loadNewsletterConfig } from "../config/newsletter-sources";

// Email addresses that are "self" - never classified as an incoming action item.
//
// Kept out of source: this repository is public and these are real addresses. The list is the
// union of every account in email-accounts.json (gitignored) and SELF_EMAILS from .env, so
// addresses the pipeline does not read from - a work address, an alias - can be added without
// having to restate the accounts.
export const SELF_EMAILS: string[] = (() => {
  const all = new Set<string>();

  try {
    for (const account of loadEmailAccounts()) {
      const user = account.user.trim().toLowerCase();
      if (user.includes("@")) all.add(user);
    }
  } catch {
    // email-accounts.json missing or malformed - fall through to the env list alone.
  }

  for (const raw of (process.env.SELF_EMAILS ?? "").split(",")) {
    const email = raw.trim().toLowerCase();
    if (email.includes("@")) all.add(email);
  }

  return [...all];
})();

/**
 * Decides whether a sender is a newsletter or a person.
 *
 * The source mappings are configuration, not code: they live in
 * `src/config/newsletter-sources.json`. Add a newsletter there, never here.
 */
export function classifyEmail(from: string): { sourceType: "newsletter" | "personal_email"; sourceName: string | null } {
  const { domains, addresses } = loadNewsletterConfig();

  const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase().trim();
  const senderDomain = senderEmail.split("@")[1] ?? "";
  const senderName = (from.match(/^([^<]+)</) ?? [])[1]?.trim() ?? "";

  // Exact address wins over a domain match.
  if (addresses[senderEmail]) {
    return { sourceType: "newsletter", sourceName: addresses[senderEmail] };
  }

  for (const [domain, name] of Object.entries(domains)) {
    if (senderDomain === domain || senderDomain.endsWith("." + domain)) {
      return { sourceType: "newsletter", sourceName: name || senderName || null };
    }
  }

  return { sourceType: "personal_email", sourceName: senderEmail };
}
