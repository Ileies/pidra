# Dashboard

## Routes

**Every page is declared once, in `dashboard/src/lib/routes.ts`.** The navbar, the mobile tab bar and the assistant's client-side surface fallback all render from that registry, and `scripts/check-route-surfaces.ts` (part of the root `bun run check`) fails the build when a registry entry's surface disagrees with what `src/ai/surfaces.ts` resolves. Adding a page means adding one entry there and, if it needs more than the `global` surface, one line in `ROUTE_SURFACES`.

- `/[date]` - daily report. Section 2 leads at every width, then the News section (`NewsSection`: the news desks' stories under the editor's headings, source links inline), then Section 1; entries carry inline +/- rating and expand their sources in place, and a personal entry carries its quick actions (`QuickActions`), with any the report never mentions in their own block at the end of Section 2. Stats bar, day steppers, archive picker, live run status. An `IngestWarning` sits above the briefing whenever a source failed to deliver on that run, because Phase 1 carries on when one dies and the report otherwise reads as complete
- `/[date]/detail/[ids]` - the extractions behind one entry; the shareable deep link and the no-JS fallback for the inline expansion
- `/[date]/triage` - everything that arrived on that run and where it stopped: dropped at ingest, never extracted, dropped at the relevance gate, seen by synthesis and passed over, or cited. Filter chips per outcome plus a search; linked from the report's "filtered" figure
- `/sources` - source quality dashboard (trust scores, include rates); a source can be hard-deleted, with an "also open unsubscribe link" option when one was found during ingest, and "Enable" stays only for sources disabled before this existed. Delete and enable/disable write directly to Postgres (`dashboard/src/lib/server/sources.ts`), so they work without the pipeline server; failures come back as a toast
- `/sources/[name]` - every delivery from one source and what extraction made of it
- `/feedback` - the item-level rating log behind the per-source totals
- `/entities` - entity explorer (filterable table); search matches name, aliases and summary, not just the canonical name
- `/entities/[id]` - one entity: a Watch control (sets `importance = 'high'` through the correction path, feeding the monitoring search slot), appearances as a timeline
- `/topics` - `active_topics`, with resolve and archive. Curation only: no skill may write this table
- `/contacts` - the sender directory. Edits go through `recordCorrection`, so they behave exactly as the assistant's do
- `/notes` - notes management: click-to-edit content, inline scope and expiry, search, sort, trash with restore, per-revision history with revert, bulk actions, undo on delete. System notes are editable too; provenance stays visible via `created_by` / `updated_by`
- `/rules` - `standing_context` CRUD, with a preview of the block as the Section 2 prompt receives it
- `/context-builder` - the harvested context document and source summaries, run controls, and a details sheet for run progress and errors; at `xl`+ Quick Links (document headings and source summaries, with scrollspy highlighting) is a persistent nav rail beside the document instead of living in the sheet, since below `xl` there's no room for both (standing rules and corrections are linked out to their own pages, not duplicated here)
- `/skills` - the pending high-risk approval queue, the read-only registry with an enable/disable toggle, and the execution log
- `/prompts` - prompt version management: diff against whatever is running for that section, activate, delete
- `/runs` - `pipeline_runs` history with duration and cost trends and the per-attempt error log; each row links to its breakdown
- `/runs/[id]` - one run's step timing from `pipeline_run_steps`: a Gantt-style time graph (the old question-gate wait, present only on historic runs, can be shrunk to see the run without it), a callout when that wait dominates, and cost per phase and per step from `$lib/pricing.ts`. Online-only; empty for runs before 2026-10-01
- `/questions` - the question queue: each open question answered or dismissed on its own, plus the recently closed ones with the reason and a reopen. Briefings never wait for answers; each is used from the next run on, and item questions sort first, then newest asked
- `/notifications` - unread reports, open questions and run errors, including individual RSS feed failures
- `/settings` - account and source configuration links
- `/settings/email-accounts` - live IMAP/SMTP account settings, one row per account with folder/aliases/ignore/SMTP/custom-instructions detail behind a per-row disclosure
- `/settings/newsletters` - live RSS feeds; a feed's latest fetch error sits below its URL and removing the row stops polling it
- `/settings/newsletters/rules` - live email sender rules routing a sender to a newsletter source before extraction; exact addresses win over domains
- `/chat` - the assistant full screen: the same `Panel` component the floating widget uses, plus the conversation list and the active corrections. Shares one live conversation with the widget

The **floating assistant** is mounted once in `+layout.svelte`, so it is reachable from every page and a turn survives navigation. Each page declares what it is showing with `setPageContext()` (`$lib/assistant/state.svelte`); the `focus` list hands the model real ids for the rows on screen. Turns stream over SSE (`POST /api/assistant/chat`), tool calls appear as they execute, and a turn that wrote something triggers `invalidateAll()` plus a highlight on the changed rows. It is hidden on `/chat`, which is the same thing full screen, and below `sm`, where the bottom bar's Chat tab replaces it.

## Conventions

Pages are wrapped in `<Page size="read|app|form|legal">`, which owns the container width and the responsive padding - four widths and one padding rule (`legal` is wider than `read`, for the privacy policy and terms - still capped prose, not a dashboard). Dates and numbers go through `$lib/format.ts`, DB enum values through `$lib/labels.ts`, cost through `$lib/pricing.ts`. Every `{@html}` goes through `renderMarkdown()` in `$lib/markdown.ts`; nothing else may call `marked`. UI language is English throughout, including the assistant's surface hints, and the palette is dark-only, with `dashboard/scripts/contrast.ts` enforcing the contrast floor on every check. The phone is the primary target: a change is checked at 390×844 on a real device before it counts as done, and a desktop viewport resized narrow is not that check (desktop widths of 1280, 1366 and 1920 px are covered by the blackhole layout lane). `dashboard/static/icons/icon.svg` is the single source for the header logo, the favicon and the PWA icon set, so editing it means regenerating the PNGs beside it. Every page also belongs to exactly one offline tier and no client code calls `fetch` directly; both rules are in `docs/offline-mode.md`.
