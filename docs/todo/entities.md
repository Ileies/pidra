# Entity system improvement plan

The entity system should answer three questions: what is this entity, why does PIDRA know about it, and how does it matter to a briefing? Today `/entities` mainly presents names and counts. The daily pipeline uses a small subset as Section 1 context, while most relationship data has no effect on a report. Repair the underlying records before expanding the page.

## Baseline and known problems

Read-only production audit on 2026-09-30:

| Measure | Result |
|---|---:|
| Entities | 549: 417 active, 127 dormant, 5 archived |
| Entities with a nonempty summary | 1 |
| Entities without type and domain | 56 |
| Entities with one recorded mention | 301 |
| Entities marked high importance | 0 |
| Entities with a stored alias | 147 |
| Relations | 119: none confirmed, none with `last_seen` later than `first_seen`, 2 below confidence 0.7 |
| Entity appearances | 0 |
| Case-insensitive duplicate canonical names | 0 |

The 215 newsletters with stored entity graphs contain 1,080 entity mentions when each graph is counted once per newsletter. The current writer visits the graph on every extracted claim, yielding 2,283 counted mentions, about 2.1 times as many. This measures the stored extraction shape, not the total historical error in `entities.mention_count`, which also contains Context Builder seed counts and may include reruns.

On the latest audited day, newsletter claims named 40 distinct entities. Against the database state after that run, 15 matched an active canonical name with at least three mentions. Eight names matched a stored alias, but the briefing matcher does not use aliases. These are snapshot checks, not a reconstruction of the exact Section 1 payload sent that morning.

Code paths behind the symptoms:

- `src/pipeline/phase2-extract.ts` copies one newsletter-level `entities_graph` onto every claim. `src/pipeline/phase6/entities.ts` counts every copy and increments again on a Phase 6 retry or same-date rerun.
- `context-builder/output/db-writer.ts` seeds names and corpus frequencies without summaries, types or domains. The daily writer adds names, types, domains and aliases, but no summaries. A correction can add a summary, explaining why nearly all rows lack one.
- `src/pipeline/phase3-context.ts` selects active rows with at least three mentions by exact canonical name from all non-news extractions, including items not sent to Section 1. `src/pipeline/phase5-synthesis.ts` sends name, type, summary and count. It does not send the stored relations, despite the Section 1 prompt calling this relationship context.
- `src/search/slots.ts` requires a dormant, high-importance entity for its monitoring slot. Automatic writers set normal importance and the live database has no high-importance rows, so the slot currently has no candidate.
- `src/pipeline/phase6/dormant.ts` revives dormant rows on a new mention but not archived rows. Relation conflicts are ignored, so an observed edge never advances `last_seen` or refreshes confidence. There is no confirmation writer. The model's 0.7 relation threshold is not enforced by the writer.
- `entity_appearances` has no writer. `/entities/[id]` renders an empty timeline and says appearances are written per report day. The page also presents confirmation as though it were an operating workflow. `/entities` searches canonical names only.

## Stage 1: make mentions and identities trustworthy

1. Define a mention as one entity in one source item. Keep source provenance with a unique key for entity plus source kind and source ID. Newsletter mentions should point to `raw_items`; harvested email and Keep mentions should point to `context_builder_indexed_items`. Store dates and safe extraction references, not another copy of raw personal content. Define whether `mention_count` represents all unique source items or separate harvested and daily counts, then label the UI accordingly.
2. Process each newsletter graph once per `raw_item_id`. Write mentions and update derived counts transactionally and idempotently. A Phase 6 retry or rerun for the same date must not increase them. Preserve the existing `entities` IDs and user-corrected fields.
3. Normalize canonical names and aliases for matching. Detect collisions and ambiguous aliases before merging rows; preserve relations, mentions and the locked correction during any merge. Keep evidence of the original spelling.
4. Build a dry-run backfill from stored newsletter extractions and Context Builder indexed items. Report proposed counts, merges and unmatched names without printing personal content. Review the diff, then apply it under the manual migration procedure in `docs/operations.md`.

Completion checks: a newsletter with several claims records one mention per entity; repeating or retrying Phase 6 leaves counts unchanged; every displayed count can be reproduced from provenance; corrected rows retain their values.

## Stage 2: repair matching, lifecycle and monitoring

1. Match today's relevant newsletter claims against canonical names and unambiguous aliases. Build entity context from the claims actually sent to Section 1, with a bounded number of entities and source references. Do not let a gate-rejected claim introduce briefing context on its own.
2. Reactivate a dormant or archived entity when a new dated source mention arrives, unless a user correction deliberately locked its status. Keep dormancy and pruning based on source dates and the defined mention semantics.
3. Add an explicit Watch control to the entity detail page, using the existing correction path so the choice is recorded and protected. Use watched entities for the dormant search slot. Track the last search per target and rotate eligible targets while honoring the shared Brave quota.
4. Search aliases and summaries in `/entities` and dashboard search. Show when an alias resolves to a different canonical name.

Completion checks: alias matches are deterministic, archived rows revive, watched entities can reach the monitoring slot, and no single target is selected indefinitely.

## Stage 3: make stored knowledge useful to the briefing

1. Build short, bounded entity context from stored extraction summaries, relevant corrections and cited source evidence. Start with frequently mentioned or watched entities. Do not create unsupported descriptions for all 549 rows merely to fill the summary column.
2. Record evidence for each relation, enforce the confidence threshold in code, and update `last_seen` on later independent observations. Send only relevant, supported edges to Section 1. Make the prompt describe the fields it actually receives.
3. Compare real briefings with and without entity context for several mornings. Look for specific useful connections, false claims, repeated information and token cost. Keep the separate newsletter graph extraction call only if its output improves the briefing or a source-backed entity view.

Completion checks: each context statement and relation can be traced to evidence, and the model receives more than a name and count when entity context is included. The relevance gate remains the authority for report inclusion.

## Stage 4: make the page honest and useful

1. Populate `entity_appearances` only from entities in cited report items. Add a unique entity/date key and replace that date's derived appearance set on a report rerun, removing entries no longer cited. Link an appearance to the final report and supporting extraction without modifying the report itself. Use a short, sourced snippet rather than raw mail text.
2. Show the source and latest evidence for each row and relation, plus the meaning of its counts. Add direct Watch and correction controls on the detail page through the existing correction writer.
3. Either provide a real confirmation action with reviewer provenance or remove the confirmed badge and count. Fix empty-state copy to describe what the system actually records.
4. If relationship evidence proves too weak to support the graph, simplify `/entities` to an entity index and remove the unused relation extraction and UI rather than maintaining decorative edges.

Completion checks: every timeline entry opens a real report, every visible relation has supporting evidence, and the page makes no claim about a feature without a working writer.

## Validation and rollout

Make separate changes for the data model and backfill, pipeline behavior, briefing retrieval, and dashboard. Before production backfill, save aggregate baselines and preview changes to the one locked entity. Test multi-claim newsletters, partial Phase 6 failure, same-date reruns, ambiguous aliases, archived revival, relation re-observation, report reruns and correction preservation. Run `bun run check` and relevant tests before each commit, then run the dashboard offline checks and inspect the page on a 390×844 phone.

After rollout, review several real mornings for match rate, nonempty evidence-backed context, repeated or unsupported relationships, monitoring activity and whether entity context changed the briefing for the better. Use those observations to decide whether to retain the relation layer and its extra model call.
