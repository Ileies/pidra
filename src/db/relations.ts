import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

// Drizzle relational-query definitions (RQB v2) over the schema; passed to `drizzle()` in src/db/index.ts.
export const relations = defineRelations(schema, (r) => ({
  rawItems: {
    extractions: r.many.extractions(),
  },
  extractions: {
    rawItem: r.one.rawItems({
      from: r.extractions.rawItemId,
      to: r.rawItems.id,
    }),
    feedbackEvents: r.many.feedbackEvents(),
  },
  feedbackEvents: {
    extraction: r.one.extractions({
      from: r.feedbackEvents.extractionId,
      to: r.extractions.id,
    }),
  },
}));
