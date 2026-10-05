import type { NewsletterConfig } from "../config/newsletter-sources";

export interface BulkHeaders {
  listUnsubscribe?: unknown;
  listId?: unknown;
  precedence?: unknown;
}

/**
 * What mailparser makes of the `List-*` headers. It folds them all into one `list` entry
 * (`{ unsubscribe: { url, mail }, id: { name } }`), so `headers.get("list-unsubscribe")` and
 * `headers.get("list-id")` are always undefined; read them through here.
 */
export function listHeaders(headers: Map<string, unknown>): { listUnsubscribe: unknown; listId: unknown; unsubscribeUrl: string | null } {
  const list = headers.get("list");
  const fields = typeof list === "object" && list !== null ? (list as Record<string, unknown>) : {};
  const url = (fields.unsubscribe as { url?: unknown } | undefined)?.url;
  return {
    listUnsubscribe: fields.unsubscribe,
    listId: fields.id,
    unsubscribeUrl: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null,
  };
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
 * Newsletter or person? Mappings come from `newsletter_sender_rules` (edited on
 * `/settings/newsletters`). Precedence: exact address, longest matching domain, `bulk` (list headers,
 * so a new newsletter works before its rule exists), else `personal_email`. Used by ingest/imap.ts.
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
