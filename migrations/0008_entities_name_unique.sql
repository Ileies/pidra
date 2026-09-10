-- Applied manually on pronix (drizzle-kit migrate hangs in this environment - see CLAUDE.md).
-- Every entity write in the codebase is an upsert keyed on the name; without this constraint
-- the `onConflictDoNothing()` calls in phase6-memory and the Context Builder's entity seeding
-- had no conflict target and silently accumulated duplicate rows.
ALTER TABLE "entities" ADD CONSTRAINT "entities_name_unique" UNIQUE("name");
