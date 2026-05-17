import { relations } from "drizzle-orm";
import {
  rawItems,
  extractions,
  entities,
  entityRelations,
  entityAppearances,
  feedbackEvents,
} from "./schema";

export const rawItemsRelations = relations(rawItems, ({ many }) => ({
  extractions: many(extractions),
}));

export const extractionsRelations = relations(extractions, ({ one, many }) => ({
  rawItem: one(rawItems, {
    fields: [extractions.rawItemId],
    references: [rawItems.id],
  }),
  feedbackEvents: many(feedbackEvents),
}));

export const entitiesRelations = relations(entities, ({ many }) => ({
  appearances: many(entityAppearances),
  relationsFrom: many(entityRelations, { relationName: "from" }),
  relationsTo: many(entityRelations, { relationName: "to" }),
}));

export const entityRelationsRelations = relations(entityRelations, ({ one }) => ({
  from: one(entities, {
    fields: [entityRelations.fromId],
    references: [entities.id],
    relationName: "from",
  }),
  to: one(entities, {
    fields: [entityRelations.toId],
    references: [entities.id],
    relationName: "to",
  }),
}));

export const entityAppearancesRelations = relations(entityAppearances, ({ one }) => ({
  entity: one(entities, {
    fields: [entityAppearances.entityId],
    references: [entities.id],
  }),
}));

export const feedbackEventsRelations = relations(feedbackEvents, ({ one }) => ({
  extraction: one(extractions, {
    fields: [feedbackEvents.extractionId],
    references: [extractions.id],
  }),
}));
