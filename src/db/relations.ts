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
  entities: {
    appearances: r.many.entityAppearances(),
    mentions: r.many.entityMentions(),
  },
  entityMentions: {
    entity: r.one.entities({
      from: r.entityMentions.entityId,
      to: r.entities.id,
    }),
  },
  entityAppearances: {
    entity: r.one.entities({
      from: r.entityAppearances.entityId,
      to: r.entities.id,
    }),
  },
  feedbackEvents: {
    extraction: r.one.extractions({
      from: r.feedbackEvents.extractionId,
      to: r.extractions.id,
    }),
  },
}));
