import { relations } from "drizzle-orm";
import {
  rawItems,
  extractions,
  entities,
  entityMentions,
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
  mentions: many(entityMentions),
}));

export const entityMentionsRelations = relations(entityMentions, ({ one }) => ({
  entity: one(entities, {
    fields: [entityMentions.entityId],
    references: [entities.id],
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
