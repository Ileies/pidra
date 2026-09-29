-- Scopes auth_credentials by relying-party ID. Dev (localhost) and prod (pidra.de) share this
-- table (same DATABASE_URL), and a credential bound to one RP ID can never authenticate the
-- other - but nothing here recorded which was which. The one existing row predates this column
-- and is prod's (pidra.de), confirmed by the owner.
ALTER TABLE "auth_credentials" ADD COLUMN "rp_id" text;
UPDATE "auth_credentials" SET "rp_id" = 'pidra.de' WHERE "rp_id" IS NULL;
ALTER TABLE "auth_credentials" ALTER COLUMN "rp_id" SET NOT NULL;
