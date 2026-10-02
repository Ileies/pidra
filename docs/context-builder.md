# Context Builder architecture

The Context Builder (`context-builder/`) builds a long-term context document from personal email, Google Tasks, Google Keep and GitHub, and seeds `contacts` and `entities`, and the standing rules in Keep as `personal` notes, in the shared Postgres database. It runs monthly on pronix as the `context-builder` job (`pidra-context-builder` timer) or by hand through the root Bun scripts. Setup, commands and recovery are in [`context-builder/README.md`](../context-builder/README.md).

## Data flow

1. **Inventory.** `run.ts` picks a mode (below) and inventories the sources. Email accounts come from the shared `email_accounts` table; news accounts are excluded. Only personal mail inside the lookback window is read (`CONTEXT_BUILDER_EMAIL_YEARS`, default 3). The fetcher reads headers first and skips automated senders and message IDs already indexed.
2. **Fetch.** Tasks and GitHub are refetched in full on every run, since both change. Keep notes come from a local gkeepapi subprocess; `sources/keep.ts` drops excluded labels before any consumer sees them (the invariant is in `docs/architecture-rules.md`, the configuration in the README).
3. **Extraction.** Email and Keep items go through strict-schema JSON extraction via `src/ai/openai.ts`, which supplies `store: false`, the flex tier and retries. Each extraction is stored per item in `context_builder_indexed_items`. Synthesis sees compressed extractions and source summaries, never raw email HTML.
4. **Synthesis.** Separate calls summarise contacts, tasks, Keep and GitHub; a final call builds the document. In update mode the final call patches the newest usable prior document with the new material. Contact and Keep summaries use the full stored extraction corpus even then, so a small delta cannot collapse them. Active `context_corrections` are passed to full and patch synthesis and outrank old harvested text.
5. **Output.** The four source summaries and `fullContext` are written to `context_builder_runs.document`, which is what the daily pipeline loads. `output/builder.ts` also writes `context-YYYY-MM-DD.json` and `.md` to `context-builder/output/` (or `CONTEXT_BUILDER_OUTPUT_DIR`) as an archival copy. The three seed writers (contacts, entities, standing context) run independently, so one failing does not skip the others.

The files hold the summaries and the document, not raw bodies or the full corpus. Updates and recovery runs rebuild from the per-item index instead.

## Modes and state

| Mode | Selected by | Work |
|---|---|---|
| Full | No completed harvest yet, or `--full` | Scans every eligible item and builds a new document. |
| Update | Default after a completed run, or `--update` | Extracts unseen email and Keep items, refreshes Tasks and GitHub, patches the prior document. |
| Resume | Plain invocation after an interrupted run | Reuses extractions already stored under the running DB row. |
| Dry run | `--dry-run` | Reports counts from a fetched inventory; no model calls, no run-state writes. |
| From index | `--from-index` | Rebuilds synthesis, output and seeds from stored extractions with a full synthesis; Tasks and GitHub are refetched. |
| Seed only | `--seed-only` | Reapplies the three DB seeds from stored extractions; no fetch, no model calls. |

State lives in three places: `context_builder_runs` (status, the document, item counts), `context_builder_indexed_items` (the persistent skip set and stored extraction JSON) and, on the machine that ran it, `.checkpoint.json` (progress) and `errors.json` (error records persisted across runs). An update whose delta exceeds 30% of the index prints a full-rebuild recommendation and proceeds.

A failed source does not abort the run; synthesis uses what arrived. Check `errors.json` timestamps and source counts before treating a completed run as full coverage.

## Document contract and daily use

`fullContext` must contain exactly five numbered level-one sections, headed `# 1.` to `# 5.` in order:

1. Identity & Relationships
2. Active Projects & Commitments
3. Knowledge Domains & Interests
4. Standing Context
5. Technical Profile

`pickSections` (`src/pipeline/long-term-context.ts`) splits on those headings. The daily personal synthesis gets sections 1, 2 and 4 (`PIPELINE_CONTEXT_SECTIONS_PERSONAL`), the intelligence synthesis 3 and 5 (`..._INTEL`), and the fields news desk only 3 (`..._NEWS`).

Both Context Builder synthesis prompts share one `DOCUMENT_STRUCTURE` constant. `run.ts` checks the result: a patch missing a section is rebuilt in full, and a document that still fails is not recorded, so the last good harvest stays the newest one. Update mode patches the newest run whose document parses, and the daily pipeline likewise scans the last five completed runs for a usable document.

`context_builder_runs.document` makes the harvest independent of which machine ran it. `output_path` (the JSON file) is a legacy breadcrumb: `readDocument()` uses it only for rows written before `document` existed, resolving a foreign absolute path by filename in the local output directory. `scripts/backfill-context-documents.ts` migrates such rows into `document`, from a machine that can still open their file.

The harvested document, entities and contacts are read-only inputs to the daily pipeline; corrections go through `src/context/corrections.ts`. Standing rules are the exception: they are ordinary notes, a separate mutable layer (`docs/architecture-rules.md`). Seeding rules:

- Contact seeds key on email address and preserve locked corrections. Corpus categories, action-required counts and email counts are set only on insert; migration `0025_contacts_corpus_metrics.sql` backfilled the first two for existing contacts.
- Entity seeds preserve the daily pipeline's running mention counts.
- Standing rules from Keep seed `personal` notes through `seedRuleNotes` and `seedHarvestedNotes` (`src/notes/store.ts`), keyed by `notes.source_key = keep_rule_<note_id>`. An existing key is never overwritten or resurrected (a trashed or edited rule stays as it is); only an untouched live note follows a changed Keep note.

The daily pipeline also runs with no harvest at all, with less personal context. The monthly job refreshes that context and is not on the critical path.
