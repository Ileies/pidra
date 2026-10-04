-- Section 2 no longer waits on questions, so nothing reads or writes the column.
ALTER TABLE "questions" DROP COLUMN IF EXISTS "blocks_until";
