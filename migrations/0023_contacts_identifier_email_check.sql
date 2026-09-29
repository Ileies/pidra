-- contacts.identifier is the sender directory's key and must actually be an email address
-- (CLAUDE.md, "contacts is an email sender directory"). One row ("system", no @, its
-- relationship field holding a reader's question answer verbatim) got in through a Section 2
-- SYSTEM-block write path that only checked for a non-empty string. That row is deleted by hand
-- before this runs; the CHECK constraint stops the class of bug from recurring even if a future
-- write path skips the Zod gate in src/pipeline/contact-suggestions.ts.
DELETE FROM "contacts" WHERE "identifier" NOT LIKE '%@%.%';
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_identifier_email_like" CHECK ("identifier" LIKE '%@%.%');
