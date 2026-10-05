// The shape of `src/db/index.ts` for `mock.module("../src/db", ...)`. Bun fixes a module's export names
// the first time it is mocked, so every test mocking it must offer all of them, or whichever test
// runs second fails with "Export named ... not found". Add new exports of src/db/index.ts here.
import * as schema from "../../src/db/schema";

export const dbModule = (db: unknown) => ({
  ...schema,
  db,
  rawItemExists: async () => false,
  existingMessageIds: async () => new Set<string>(),
});
