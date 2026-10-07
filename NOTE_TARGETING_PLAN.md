# NOTE_TARGETING_PLAN.md - Step-bound and item-targeted notes

Status: proposed, not authorized. Open parts move to `docs/todo/` when this is finished, then this file is deleted.

## Problem

A chat-created note ("my netcup payments are automated") defaults to `global` scope (`write_note`) and is then injected into every stage that reads that scope: classification, Section 1, Section 2. It only matters when classifying one sender's mail. Every other call pays for it in tokens and context noise.

Current loading (verified in code):

| Stage | Where | Selection |
|---|---|---|
| Classification / extraction | `src/pipeline/phase2-extract.ts` `loadClassificationContext` | `personal`+`contact`+`global`, newest 30, 400 chars each, no `expires_at` check |
| Synthesis context | `src/pipeline/phase3-context.ts` | all live notes; `intel`+`global` to Section 1, `personal`+`global` to Section 2, no cap |
| News editor / desks | `src/news/format.ts`, `src/news/store.ts` | `intel` only |
| Quick actions | `src/actions/propose/index.ts` | `personal` only |
| Question reconcile | `src/questions/reconcile.ts` | `personal`+`contact`, no expiry check, no cap |
| Search slot 3 | `src/search/slots.ts` | `search` scope, used as a Brave query, not a prompt |
| Chat assistant | `list_notes` skill | on demand, not preloaded |

The only available levers are `scope` and `expires_at`. There is no sender, step, or relevance targeting.

Known defects to fix on the way:
- Classification ignores `expires_at` (violates `docs/architecture-rules.md` notes rule).
- Reconcile ignores `expires_at`.
- Weekly meta-run inserts `global` prompt-diff notes directly with `db.insert` (bypasses the single-writer rule in `src/notes/store.ts`), and they flow into extraction and both sections.
- Classification's "newest 30" cut can push out an old but relevant rule.

## Design

### New fields on `notes`

- `steps text[]` - which stages load the note. Empty or null means all stages the scope already reaches (backward compatible). Values: `classify`, `extract`, `section1`, `section2`, `news`, `actions`, `reconcile`.
- `applies_to jsonb` - optional narrowing, null means always. Keys, all optional, AND-combined, each a list matched OR-wise:
  - `senders`: sender address or domain (e.g. `netcup.de`)
  - `entities`: entity names or ids
  - `keywords`: case-insensitive substrings of the item text
- `active_from date` - note is live from this day (pairs with the existing `expires_at`).

No semantic matching: embeddings stay out of the pipeline (`docs/architecture-rules.md`). Keyword match is plain substring.

Defaults stay "always load". Narrowing is opt-in, so existing notes, Keep-seeded rules and meta-run notes behave as today until someone narrows them.

### One selector

`selectNotesFor(step, item?)` in `src/notes/` replaces the per-stage queries. It owns:
- `deleted_at IS NULL`, `active_from <= runDate`, `expires_at` null or `>= runDate` (fixes the expiry gaps)
- scope filter per step (existing mapping preserved)
- `steps` filter
- `applies_to` match against the item when an item is given (classification knows sender and entities before building the prompt)
- the per-stage cap and char limit, applied after relevance filtering, so relevance beats recency

Stages without a single item (Section 1, Section 2, news) pass no item: `applies_to` notes with `senders` or `keywords` only load there if the stage's own input matches, otherwise they are skipped. Decide per stage during implementation and document it.

### Chat agent

`write_note` gains `steps` and `applies_to` parameters. The tool description tells the model to infer them (netcup note: `steps: ["classify"]`, `applies_to.senders: ["netcup"]`) and to state the targeting in its reply so the user can correct it. The `list_notes` output and the dashboard notes page show and allow editing of the new fields. Changes go through `src/notes/store.ts` so `note_revisions` records them.

### Observability

Silent misses are the main risk (a too-narrow note never loads and nobody notices). So:
- Record which note ids were loaded per run and step (small table or a counter on the note, to be decided).
- Dashboard: per-note "loaded N times, last loaded" and a "never loaded in 30 days" filter.

### Notes page filters

The `/notes` page gets a narrowness filter next to the existing scope filter. A note's narrowness is derived, not stored:
- **Always**: no `steps`, no `applies_to` (loads wherever its scope reaches)
- **Step-bound**: `steps` set, no `applies_to`
- **Targeted**: `applies_to` set (sender, entity or keyword), with or without `steps`
- **Dated**: `active_from` set or `expires_at` set

Also filterable: by step (show every note that can reach `classify`), by sender or entity, and by "never loaded". Each row shows a compact badge for its narrowness and targets. The same derived value is exposed as a `list_notes` filter so the chat agent can audit notes too.

## Phases

1. **Selector, no behavior change.** Add `selectNotesFor`, route all readers through it, fix the two `expires_at` gaps. Tests in `tests-db/`.
2. **Schema + matching.** Add the three columns (migration per `docs/operations.md`), implement `steps`, `applies_to`, `active_from` in the selector. Classification passes the item.
3. **Writers.** Extend `write_note` / `update_note` and the store; route the meta-run through the store; cap or exclude meta-run `global` notes from pipeline prompts.
4. **Dashboard.** Edit fields, load counters, "never loaded" view, narrowness/step/target filters and badges on `/notes`, matching `list_notes` filter.
5. **Cleanup by hand.** Narrow existing notes (netcup first) once the "never loaded" view exists. No automatic migration. Also rewrite the notes themselves: many date from the app's first days, are messily worded, or are verbatim copies of Google Keep notes. Rewrite each as a short, self-contained instruction (merge duplicates, drop stale ones) through `update_note`, so the history keeps the original, and do it together with the targeting so each note is read once.

## Out of scope

- Event triggers beyond date and sender/entity/keyword matching.
- Semantic or embedding relevance.
- Per-contact binding of `contact` scope (possible later via `applies_to.entities`).

## Open questions

- Items without a sender (SMS, calendar, tasks): which `applies_to` keys apply?
- Where to store load counts: per-note counter vs. per-run log table.
- Whether Section 1/2 should ever honor `keywords`, or only `steps`.

## Docs to update at commit time

`docs/architecture-rules.md` (notes rules), `docs/schema-notes.md` (notes columns), `docs/skills.md` (`write_note`), `docs/dashboard.md` (notes page). Leave these to `docs-committer` via `/commit`.
