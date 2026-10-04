import type { NewsletterConfig } from "../config/newsletter-sources";

export interface BulkHeaders {
  listUnsubscribe?: unknown;
  listId?: unknown;
  precedence?: unknown;
}

/** True when the headers mark the mail as sent to a list rather than written to one person. */
export function isBulkMail({ listUnsubscribe, listId, precedence }: BulkHeaders): boolean {
  if (listUnsubscribe || listId) return true;
  return typeof precedence === "string" && ["bulk", "list"].includes(precedence.trim().toLowerCase());
}

/** The bare lower-case address of a `Name <addr>` or plain-address From header. */
export function senderAddress(from: string): string {
  return ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase().trim();
}

/**
 * Decides whether a sender is a newsletter or a person.
 *
 * The source mappings are configuration, not code: they live in
 * `newsletter_sender_rules`, edited from `/settings/newsletters`. A sender no rule matches is still
 * a newsletter when `bulk` is set (the mail carries list headers), so a newly subscribed
 * newsletter reaches the newsletter path before anyone has written its rule.
 */
export function classifyEmail(
  from: string,
  { domains, addresses }: NewsletterConfig,
  bulk = false,
): { sourceType: "newsletter" | "personal_email"; sourceName: string | null } {

  const senderEmail = senderAddress(from);
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

  if (bulk) {
    const displayName = senderName.replace(/^["']+|["']+$/g, "").trim();
    return { sourceType: "newsletter", sourceName: displayName || senderDomain || null };
  }

  return { sourceType: "personal_email", sourceName: senderEmail };
}
