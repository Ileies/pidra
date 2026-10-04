import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, jsonb, pk, timestamptz, updatedAt } from "./columns";

/**
 * One registered WebAuthn passkey; `dashboard/src/lib/server/auth.ts` is the only writer. `rpId`
 * scopes every read to its relying party, because dev (`localhost`) and prod share this table.
 */
export const authCredentials = pgTable("auth_credentials", {
  id: pk(),
  credentialId: text("credential_id").unique().notNull(),
  rpId: text("rp_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceLabel: text("device_label"),
  transports: jsonb("transports").$type<string[]>(),
  createdAt: createdAt(),
  lastUsedAt: timestamptz("last_used_at"),
});

/** The PIN, checked after a passkey assertion succeeded: a single mutable row, replaced in place. */
export const authPin = pgTable("auth_pin", {
  id: pk(),
  pinHash: text("pin_hash").notNull(),
  updatedAt: updatedAt(),
});

/** A logged-in session. `id` is the SHA-256 hash of the raw token the cookie carries. */
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  createdAt: createdAt(),
  expiresAt: timestamptz("expires_at").notNull(),
  lastSeenAt: timestamptz("last_seen_at"),
  userAgent: text("user_agent"),
});
