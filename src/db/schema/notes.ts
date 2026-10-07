import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, dateStr, pk, timestamptz } from "./columns";
import { skillExecutions } from "./config";
import { chatConversations } from "./chat";

/** The mutable working layer: standing instructions plus what Phase 6 writes. Edited in place with the prior state appended to `noteRevisions`; deletes are soft. Only `src/notes/store.ts` writes it. */
export const notes = pgTable("notes", {
  id: pk(),
  content: text("content").notNull(),
  scope: text("scope").notNull(), // global | intel | personal | contact | search
  createdAt: createdAt(),
  expiresAt: dateStr("expires_at"),
  createdBy: text("created_by").default("system"), // system | user | chat | harvest
  updatedAt: timestamptz("updated_at"),
  updatedBy: text("updated_by"), // user | chat | system | harvest - never rewrites createdBy
  /** Soft delete. Every consumer must filter `deleted_at IS NULL`. */
  deletedAt: timestamptz("deleted_at"),
  /** The review question(s) `absorbReviewAnswers` drew this note from; empty for any other source. */
  sourceQuestionIds: uuid("source_question_ids").array().notNull().default(sql`'{}'::uuid[]`),
  /** Identity of a note seeded from Keep (`keep_rule_<note id>`), unique where set; such a row is never purged from the trash. */
  sourceKey: text("source_key"),
  /** Pipeline steps that load this note (`NoteStep` in src/notes/select.ts); empty means every step its scope reaches. */
  steps: text("steps").array().notNull().default(sql`'{}'::text[]`),
  /** Narrowing to the item being processed: `{ senders?, entities?, keywords? }` (`NoteTargets` in src/notes/select.ts). Null means always. */
  appliesTo: jsonb("applies_to").$type<{ senders?: string[]; entities?: string[]; keywords?: string[] }>(),
  /** First day the note is live; pairs with `expiresAt`. Null means live from creation. */
  activeFrom: dateStr("active_from"),
});

/** Append-only history for `notes`, holding the state *before* each change. */
export const noteRevisions = pgTable("note_revisions", {
  id: pk(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(), // update | delete | restore
  previousContent: text("previous_content"),
  previousScope: text("previous_scope"),
  previousExpiresAt: dateStr("previous_expires_at"),
  changedBy: text("changed_by").notNull(), // user | chat | system | harvest
  skillExecutionId: uuid("skill_execution_id").references(() => skillExecutions.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => chatConversations.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
