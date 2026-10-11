# Now

See `docs/todo/README.md` for the conventions this list follows.
- **[INFRA]** Drop the `entities`, `entity_mentions` and `entity_appearances` tables and the `active_topics.entity_ids` column on pronix at deploy (the Drizzle schema no longer declares them, the DROP SQL is not run by the code), then delete this line.
