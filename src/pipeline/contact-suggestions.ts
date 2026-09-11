import { z } from "zod";

const ContactSuggestionSchema = z.object({
  // This is the sender address used as the durable, unique contact key. It must
  // never be substituted with the display name from an email.
  identifier: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  relationship: z.string().trim().min(1).optional(),
  priority: z.enum(["critical", "high", "normal", "low"]).default("normal"),
});

export type ContactSuggestion = z.infer<typeof ContactSuggestionSchema>;

/**
 * Model-produced SYSTEM blocks are untrusted input. Keep valid suggestions,
 * but make an incomplete optional contact suggestion unable to fail Phase 6.
 */
export function validateNewContacts(value: unknown): {
  contacts: ContactSuggestion[];
  skipped: number;
} {
  if (!Array.isArray(value)) return { contacts: [], skipped: value === undefined ? 0 : 1 };

  const contacts: ContactSuggestion[] = [];
  let skipped = 0;
  for (const candidate of value) {
    const result = ContactSuggestionSchema.safeParse(candidate);
    if (result.success) contacts.push(result.data);
    else skipped++;
  }
  return { contacts, skipped };
}
