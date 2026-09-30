# Context Builder architecture

The Context Builder (`context-builder/`) makes a long-term context document from personal email, Google Tasks, Google Keep, and GitHub. It also seeds `contacts`, `entities`, and `standing_context` in the shared Postgres database. It runs monthly on pronix through the `context-builder` job, or by hand through the root Bun scripts. See [`context-builder/README.md`](../context-builder/README.md) for setup, commands, and operational recovery.

## Data flow

1. `run.ts` selects a mode and inventories the sources. Email accounts come from the shared `email_accounts` table. News accounts are excluded from this harvest. Personal mail is limited to the configured lookback window, three years by default. The email fetcher reads headers before downloading a body and skips automated senders and indexed message IDs.
2. Google Tasks and GitHub are fetched on every ordinary run because task state and repositories can change. Keep notes are fetched through the local gkeepapi subprocess. `sources/keep.ts` removes notes with excluded labels before extraction or any other consumer sees them. The default excluded label is `Credentials`; `CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS` configures the list.
3. Email and Keep items pass through structured JSON extraction via `src/ai/openai.ts`. The durable per-item extraction and source ID live in `context_builder_indexed_items`. The configured extraction and synthesis models default to `gpt-5.6-luna`; the shared client supplies `store: false`, the flex service tier, and retries. Synthesis sees compressed extractions and source summaries, not raw email HTML.
4. Separate synthesis calls summarize contacts, tasks, Keep, and GitHub. A final call builds the document. An update patches the latest usable document using the new information and the prior document. Contact and Keep summaries in update mode use the full stored extraction corpus, so a small delta does not collapse their standalone summaries. Active `context_corrections` are supplied to full and patch synthesis and outrank old harvested text.
5. `output/builder.ts` writes `context-YYYY-MM-DD.json` and `.md` in `context-builder/output/` or `CONTEXT_BUILDER_OUTPUT_DIR`. The JSON contains the four source summaries and `fullContext`. `context_builder_runs.output_path` identifies the document the daily pipeline may load. The three seed writers run independently; a failure in one is logged without skipping the others.

The output files are derived snapshots. They do not contain the full raw email bodies or complete source corpus. The per-item index provides the extraction data needed for a later update or recovery run.

## Modes and state

| Mode | Selection | Work |
|---|---|---|
| Full | First completed harvest absent, or `--full` | Scans all eligible items and builds a new document. |
| Update | Default after a completed run, or `--update` | Extracts unseen email and Keep IDs, refreshes Tasks and GitHub, and patches a usable prior document. |
| Resume | Unflagged invocation after an interrupted run | Reuses extractions already stored under the running DB row and continues that run. |
| Dry run | `--dry-run` | Fetches an inventory and reports counts without model calls or run-state writes. |
| From index | `--from-index` | Rebuilds synthesis, output, and seeds from stored email and Keep extractions; Tasks and GitHub are fetched again. |
| Seed only | `--seed-only` | Reapplies the three DB seeds from stored extractions without fetching or model calls. |

`context_builder_runs` records run status, output path, and item counts. The progress display tracks model usage during the run. `context_builder_indexed_items` is the persistent skip set and stores extraction JSON. `.checkpoint.json` tracks current progress, while `errors.json` persists error records across runs. A delta larger than 30% of the existing index prints a full rebuild recommendation, but the update proceeds.

A source failure does not necessarily abort the harvest: synthesis uses what arrived. Check `errors.json` with its timestamps and the source counts before treating a completed run as complete coverage. The terminal progress view becomes journal lines under systemd.

## Document contract and daily use

`fullContext` must contain exactly five numbered level-one sections, with headings beginning `# 1.` through `# 5.` in order:

1. Identity & Relationships
2. Active Projects & Commitments
3. Knowledge Domains & Interests
4. Standing Context
5. Technical Profile

`src/pipeline/long-term-context.ts` splits on those headings. The daily personal synthesis receives sections 1, 2, and 4; intelligence receives 3 and 5; the news desk receives only 3. The two Context Builder synthesis prompts share the heading instructions. `run.ts` validates a patch, rebuilds it in full if needed, and records no `output_path` if the result still lacks a section. The daily pipeline searches recent completed runs for a usable document and falls back when a newer one is missing or unreadable. A harvest run on another machine can have a different absolute output path, so `readDocument()` also looks up the same filename in the local output directory.

The harvested document and standing rules are inputs to the daily pipeline, not editable working memory. Corrections go through `src/context/corrections.ts`; notes are a separate mutable layer. Contact seeds use email addresses and preserve locked corrections. They set corpus categories, action-required counts, and email counts only when inserting a contact, so a later seed does not replace those values. Migration `0025_contacts_corpus_metrics.sql` fills the two new metrics for existing contacts from stored email extractions without changing their email counts. Entity seeds preserve the daily pipeline's running mention counts. Standing rules from Keep use stable `keep_rule_<note_id>` keys.

The daily pipeline runs without a harvest, with less personal context. The monthly job refreshes that context; it is not part of the daily pipeline's critical path.
