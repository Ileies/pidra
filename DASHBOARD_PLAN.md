# Dashboard Redesign Plan

Scope: `dashboard/` only. Goal is a dashboard that is pleasant to read on a phone at 06:45,
and complete enough that every table the pipeline writes has a place in the UI.

Written 2026-09-10 against the current tree (8 pages, ~1,300 lines of Svelte, no shared components).

---

## 1. Current state

### What works
- Token palette is coherent and the color choices are good (`app.css`, cerberus override).
- `[date]` prev/next/today stepping, stats bar, pipeline error card with per-attempt stack traces.
- `/[date]/detail/[ids]` is genuinely well built: extraction cards, novelty and urgency badges,
  optimistic +/- rating, deep-dive action.
- `/context-builder` is the most modern page in the app: runes, polling, progress bars, phase grid.
  It is the reference for what the rest should look like.

### Structural problems

| # | Problem | Evidence |
|---|---|---|
| S1 | `+layout.svelte` is 5 lines (`<slot />`). Every page rebuilds its own header, wrapper and container. | `routes/+layout.svelte` |
| S2 | `const navBtn = "px-3 py-1 rounded text-xs ..."` copy-pasted verbatim in 6 files. | date, entities, notes, skills, prompts, questions, context-builder |
| S3 | 5 different local `fmtDate` implementations with 5 different format options. | one per page |
| S4 | `src/lib/` holds only `db.ts` and `server/contextBuilder.ts`. Zero UI components. | `ls dashboard/src/lib` |
| S5 | Svelte 4 and Svelte 5 APIs mixed: `export let data` + `on:click` in 7 pages, runes in 1. `prompts` still uses `$:`. Violates the global "runes throughout, never legacy" rule. | all pages except context-builder |
| S6 | Nav exists only on `/[date]`. Every other page has a single "← Heute" link, so `/sources` → `/entities` requires a round trip through the report. | all subpages |
| S7 | `/prompts` is documented in CLAUDE.md but not linked from anywhere. Reachable only by typing the URL. | nav lists in all pages |
| S8 | `[date]/+page.server.ts` runs 4 sequential queries plus a conditional 5th, none in `Promise.all`. It also fetches 60 dates to compute prev/next. | `+page.server.ts:42-80` |
| S9 | UI language is mixed per page and sometimes within a page: "Quellen / Entities / Notes / Skills / Questions" in one nav row; "Keine Entities gefunden" next to "No skill executions yet". | nav + empty states |

### Design problems

| # | Problem | Evidence |
|---|---|---|
| D1 | Two parallel token systems for the same colors: Skeleton `--color-surface-*` and legacy `--bg/--text/--accent`. Any palette change must be made twice. | `app.css:13-60` |
| D2 | `font-family: "Inter"` is set but Inter is never loaded (no `@font-face`, no stylesheet link). Silently falls back to system-ui. Same for "JetBrains Mono" in code spans. | `app.css:73`, `app.html` |
| D3 | No type scale. Everything is 15px/1.6 plus per-element ad-hoc sizes. Report body is capped at `max-w-4xl` (56rem), roughly 110 characters per line: about double a comfortable reading measure. | `app.css:69-76`, `[date]/+page.svelte:168` |
| D4 | No spacing or container scale. Page paddings are `px-8 py-3`, `px-6 py-6`, `px-8 py-8`; containers are `max-w-2xl`, `3xl`, `4xl`, `5xl`, one per page, chosen arbitrarily. | all pages |
| D5 | Dark-only, hard-forced via `color-scheme: dark` on `:root`. No light mode, no toggle, no respect for system preference. | `app.css:8-10` |
| D6 | No focus-visible styling anywhere. `focus:outline-none` appears 6 times, sometimes replaced only by a border-color change. Keyboard navigation is effectively invisible. | entities, notes, questions |
| D7 | Status conveyed by color alone: source trend is a bare arrow glyph, score is a colored number, importance is a colored word. Fails at a glance and for color-vision deficiency. | `sources/+page.svelte:7-35` |
| D8 | `/[date]` header is a non-wrapping `justify-between` flex with a 10-item nav at 12px. Guaranteed horizontal overflow on a phone, which is the primary device for this app. | `[date]/+page.svelte:93-127` |
| D9 | `/sources` table has no responsive treatment at all (6 columns, one with an inline form). `/entities` at least hides columns progressively. | `sources/+page.svelte:64` |
| D10 | PWA is a stub: one SVG icon (no 192/512 PNG, so Android install and splash degrade), `theme_color: #0f1117` does not match the real background `#111214` (visible status-bar seam), no offline cache in `sw.js`. | `static/manifest.webmanifest`, `static/sw.js` |
| D11 | The report is one flat `{@html}` blob although its structure is known and fixed by the synthesis prompts. | `[date]/+page.svelte:169-172` |

### Correctness issues found while reading

| # | Issue | Where |
|---|---|---|
| C1 | `{@html}` on `marked()` output with no sanitizer. `marked` does not sanitize; the input is LLM output derived from ingested newsletter HTML. Same for `form.deepDiveHtml`. | `[date]/+page.server.ts:83`, `detail/+page.svelte:178` |
| C2 | Context Builder cost is computed with `$3.00 / $15.00` per Mtok, which are Sonnet prices, applied to `gpt-5.6-luna` token counts. The number displayed is wrong. | `context-builder/+page.svelte:64-67` |
| C3 | `availableDates` (60 entries) is loaded, returned to the client, and never used. | `[date]/+page.server.ts:121` |
| C4 | Rating buttons carry `title=` but no accessible name; `+`/`−` alone is not a label. | `detail/+page.svelte:131-138` |
| C5 | "Pipeline läuft… Seite in einigen Minuten neu laden" asks the user to reload manually, while `/context-builder` already demonstrates polling in this codebase. | `[date]/+page.svelte:176` |

### Functional gaps: tables written by the pipeline with no UI

| Table | Status |
|---|---|
| `active_topics` | No UI. Story continuity is the core value of the system and is invisible. |
| `contacts` | No UI, although the question gate exists to enrich it. |
| `standing_context` | No UI, although the entire point is that the user curates the rules injected into Section 2. |
| `entity_relations` / `entity_appearances` | No UI. `/entities` is a flat table with no detail page, no edges, no timeline. |
| `feedback_events` | Written, never displayed. No way to see what was rated or whether it changed anything. |
| `source_daily_scores` | Rendered as an unlabeled dot scatter with no axis, values or tooltip. |
| `pipeline_runs` | Error card only appears on a date with no report. Successful run timings and step breakdown are invisible; there is no run history. |
| `skill_executions` (status `pending`) | CLAUDE.md specifies that `high`-risk skills wait for manual confirmation. `/skills` has no confirm or reject control, so the documented approval workflow has no UI. |
| `prompt_versions` | `/prompts` shows full prompt text in a `<pre>` with no diff against the active version. Approval is blind. |
| `daily_reports` archive | No date picker, no archive list, no cross-report search. |
| cost | Tokens shown, cost never derived on the daily page. |

---

## 2. Phase A: design foundation

The prerequisite for everything else. No visible feature work, one commit, low risk.

**A1. Single token source.**
Delete the legacy `--bg/--text/--accent` block. Define semantic tokens on top of the
Skeleton scale, and drive `.report-body` from those:

```css
:root {
  --app-bg: var(--color-surface-950);
  --app-panel: var(--color-surface-900);
  --app-border: var(--color-surface-700);
  --app-text: var(--color-surface-200);
  --app-text-strong: var(--color-surface-50);
  --app-text-muted: var(--color-surface-500);
}
```

Every `.report-body` rule then references `--app-*`, so a palette change happens in one place.

**A2. Type scale + real fonts.**
Self-host Inter (variable) and JetBrains Mono under `static/fonts/` with `@font-face` and
`font-display: swap`. No CDN: the dashboard runs on the LAN and should not depend on external
hosts. Define a scale as tokens (`--text-xs` … `--text-2xl`), set `font-feature-settings`
for tabular numbers on the stat classes, and set the report measure to `max-w-[68ch]`
instead of `max-w-4xl`.

**A3. Spacing and container scale.**
Three container widths only: `--w-read` (68ch, report and detail), `--w-app` (72rem, tables),
`--w-form` (40rem, questions and forms). One page padding rule, responsive:
`px-4 sm:px-6 lg:px-8`. Codify in `src/lib/ui/layout.ts` as exported class constants.

**A4. Light mode.**
Drop the forced `color-scheme: dark`. Define the light palette on bare `:root`, override under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again
under `:root[data-theme="dark"]` so an explicit toggle wins both ways. Persist the choice in
`localStorage` and set it in `app.html` before hydration to avoid a flash.
Ship dark as the default. Cost: about half a day; the benefit is a dashboard that is readable
on a phone in daylight.

**A5. Focus and motion.**
Global `:focus-visible` ring (2px, `--color-primary-400`, 2px offset). Remove every
`focus:outline-none` that is not paired with a replacement ring. Wrap `animate-pulse` and all
transitions in `@media (prefers-reduced-motion: reduce)`.

**A6. Migrate to runes.**
`export let` → `$props()`, `on:click` → `onclick`, `$:` → `$derived`, `<slot />` →
`{@render children()}`. Mechanical, 7 files, and it unblocks the shared layout in Phase B.
Run `bun run check` after: this is the commit most likely to surface real type errors.

---

## 3. Phase B: application shell

**B1. Real root layout.** Move header, nav, page frame and theme toggle into `+layout.svelte`.
Every page then renders only its own content. Removes S1, S2, S6, S7 and roughly 200 lines
of duplication in one move.

**B2. Component library** in `src/lib/components/`:

| Component | Replaces |
|---|---|
| `AppHeader.svelte` | 8 hand-built headers |
| `NavBar.svelte` | 6 copies of `navBtn`, with `aria-current="page"` |
| `Badge.svelte` | ad-hoc `badge` + class-map objects in 5 files |
| `StatBar.svelte` | the inline stats row on `[date]` |
| `DataTable.svelte` | sources and entities tables, with a shared responsive strategy |
| `EmptyState.svelte` | 6 one-off centered paragraphs |
| `ErrorCard.svelte` | the pipeline error card, reusable for context-builder errors |
| `Sparkline.svelte` | the raw SVG dot scatter, with axis, min/max labels and title |
| `ConfirmButton.svelte` | the inline confirm dance in `/sources` |
| `Spinner.svelte` / `Skeleton.svelte` | the "loading…" text swaps |

Plus `src/lib/format.ts`: one `fmtDate`, `fmtDateTime`, `fmtNum`, `fmtPct`, `fmtScore`,
`fmtElapsed`, `fmtCost`. Fixes S3 and C2 at the same time, since cost gets a single
definition with the real model prices.

**B3. Responsive navigation.** Desktop: a horizontal bar grouped as
`Report | Sources · Entities · Topics · Contacts | Notes · Rules | Skills · Prompts · Runs`.
Mobile: a bottom tab bar for the four routes used daily (Report, Topics, Notes, Search) plus
a sheet for the rest. The nav badge for pending questions and pending skills belongs here, not
inline in a link.

**B4. Language decision.** Pick one UI language and apply it everywhere. Recommendation: German,
since the report content itself is German and the user is the only reader. Keep DB values,
scope names and status enums in English and translate them only at the display layer via
a `LABELS` map in `src/lib/labels.ts`.

---

## 4. Phase C: the report reading experience

This is where the design work pays off. The report is the product; everything else is admin.

**C1. Parse instead of dumping.** The synthesis prompts fix the structure
(`## Intelligence Briefing`, `### {Domain}`, `### Also noted`, `## Personal Action Center`,
`### Critical`, `### High priority`, `### Normal`, `### Mentions`). Parse the markdown
server-side into a typed tree:

```ts
type Report = {
  intel:    { domain: string; entries: Entry[] }[];
  alsoNoted: Entry[];
  personal: { urgency: "critical" | "high" | "normal" | "mentions"; entries: Entry[] }[];
};
type Entry = { html: string; refIds: string[] };
```

Rendering per entry instead of per document unlocks C2 through C6 and confines `{@html}`
to small, sanitized fragments.

**C2. Sanitize.** Add `isomorphic-dompurify` (or `marked` + explicit allowlist) at the
`marked()` call. Non-negotiable given `{@html}`, and cheap once parsing is centralized. Fixes C1.

**C3. Two-panel structure.** Personal Action Center first on mobile (it is the actionable half),
Intelligence Briefing second, with a sticky segmented control to switch. On desktop, Section 2
as a right rail and Section 1 as the main column. Critical items get a left accent border in
`--color-error-500`, high priority in warning, normal unadorned. Urgency stops being a
heading you scroll past.

**C4. Inline rating.** Move the +/- from the detail page onto every report entry with a `refs`
anchor: hover on desktop, always visible on mobile. `feedback_events` currently only fills up
if the user takes a two-click detour, which means the relevance calibration loop is starved.
This is the single highest-leverage UX change in the plan.

**C5. Inline expansion instead of navigation.** "Mehr dazu" currently navigates away and loses
scroll position. Make it expand the extraction cards in place (the detail page's content,
rendered inline) and keep `/[date]/detail/[ids]` as the deep-link fallback.

**C6. Section anchors.** A domain jump list ("Also noted", per-domain) as a floating TOC on
desktop, collapsible on mobile. Report is 600-900 words plus 300-500, so a phone read is
several screens of scrolling with no orientation.

**C7. Live pipeline status.** Replace "reload the page in a few minutes" with an SSE endpoint
or a 5s poll against `pipeline_runs` and a phase progress display, reusing the
`/context-builder` progress-bar pattern. The report appears when it is ready. Fixes C5.

**C8. Archive and date picker.** `availableDates` is already loaded and unused (C3). Give it
a real calendar popover with report days marked, a "last 7 / 30 days" list with each day's
`short_summary` as preview, and keyboard `j`/`k` for previous/next day.

**C9. Cost on the stats bar.** Derive from `tokens_in`/`tokens_out` with the shared `fmtCost`,
show as a hover detail on the token counts, and add a 30-day cost sparkline to the runs page (D5).

---

## 5. Phase D: functional gaps

Ordered by value per hour of work.

**D1. `/topics` (new): active topics.** The story continuity table, which is the reason the
system compounds, has no UI. List active topics with running summary, domain, first-seen,
last-updated, mention count; a timeline of the reports in which each appeared; an
archive/resolve action. Highest-value new page.

**D2. `/entities/[id]` (new): entity detail.** Name, aliases, type, domain, summary, importance,
status, `entity_relations` as an adjacency list (with confidence), `entity_appearances` as a
timeline, and links to the reports that mentioned it. Turns a flat table into an actual graph
explorer. A force-directed view is optional and lower value than the detail page.

**D3. `/rules` (new): standing context.** CRUD over `standing_context` with the type
(`rule` | `preference`), the source (Keep-seeded vs. hand-written), and a preview of the block
as it is injected into the Section 2 prompt. The system is designed around the user curating
these and there is currently no way to do so.

**D4. `/skills` approval controls.** Add Confirm and Reject for `pending` executions, a pending
count badge in the nav, and grouping by status. Implements a workflow CLAUDE.md already
specifies as manual.

**D5. `/runs` (new): pipeline run history.** `pipeline_runs` as a table: date, status, duration,
failed step, per-phase timing, tokens, derived cost. A duration and cost trend chart.
Currently a successful run is invisible and a failed one only surfaces on its own date page.

**D6. `/prompts` diff view.** Render a line-level diff between the proposed version and the
currently active one for the same section, with the change summary above it. Collapse
identical context. Approving a prompt change blind is the current default and this is the
one page where the plan explicitly demands human judgement.

**D7. `/contacts` (new).** Contacts table with the context accumulated from the question gate,
inline editing, and the count of interactions. Lets the user pre-empt questions instead of
answering the same one twice.

**D8. Search.** Full-text search across `daily_reports.full_report`, `extractions`, `notes`
and `entities` via Postgres `tsvector` (no vector store, per the architecture rule).
A `⌘K`/`Ctrl+K` palette is the natural home for it, together with route jumping.

**D9. Feedback view.** A small page or a `/sources` tab listing recent `feedback_events` with
the item rated, so the calibration loop is auditable.

---

## 6. Phase E: UX polish

- **E1. Keyboard.** `j`/`k` day stepping, `/` search, `g` then a letter for route jumping,
  `?` for a shortcut overlay, `⌘K` palette. A daily tool earns these quickly.
- **E2. Loading states.** Skeleton rows for tables, a spinner in buttons already covered by
  `Spinner.svelte`, and `navigating` from `$app/state` for a top progress bar.
- **E3. Toasts.** Replace the four different inline `form?.error` / `form?.success` renderings
  with one toast store, keeping inline errors only for field-level validation.
- **E4. PWA completion.** PNG icons at 192/512 plus a maskable variant, `theme_color` corrected
  to `#111214`, `display_override: ["standalone"]`, shortcuts to Report / Topics / Notes,
  and a service-worker cache of the last 7 report pages so the briefing is readable offline
  (the whole point of a PWA on a phone).
- **E5. Push depth.** The notification currently opens `/`. Include the report date and
  `short_summary` in the payload and deep-link to that date; add an action to jump straight
  to Section 2.
- **E6. Accessibility pass.** `aria-current` on nav, `scope="col"` on table headers, accessible
  names on all icon buttons (fixes C4), a skip link, contrast verification for
  `text-surface-500` on `surface-900` (currently about 3.9:1, below AA for body text),
  and a text or shape indicator alongside every color-coded status (fixes D7).
- **E7. Query parallelization.** `Promise.all` in `[date]/+page.server.ts`, and replace the
  60-row date fetch with two scalar queries for prev and next plus a separate archive endpoint
  (fixes S8).

---

## 7. Sequencing

| Step | Content | Effort | Risk |
|---|---|---|---|
| 1 | Phase A: tokens, fonts, scales, focus, runes migration | 1 day | low, no behavior change |
| 2 | Phase B: layout, components, nav, language | 1-2 days | low, large deletion of duplication |
| 3 | C1, C2, C4: parse, sanitize, inline rating | 1 day | medium, touches the core render path |
| 4 | C3, C6, C7, C8: structure, TOC, live status, archive | 1-2 days | medium |
| 5 | D1, D3, D4: topics, rules, skill approval | 1-2 days | low, additive |
| 6 | Phase A4 light mode + E4 PWA + E6 accessibility | 1 day | low |
| 7 | D2, D5, D6, D8: entity detail, runs, prompt diff, search | 2-3 days | low, additive |
| 8 | E1, E2, E3, D7, D9: keyboard, loading, toasts, contacts, feedback | 1-2 days | low |

Steps 1 and 2 are prerequisites for everything else and should not be split across sessions.
Step 3 should ship as its own commit set, since it is the only step that can visibly break the
report.

Commit granularity per the project rule: one commit per phase item, not per phase.
Run `bun run check` in `dashboard/` before each commit.

## 8. Dependencies to add

- `isomorphic-dompurify` (C2), required.
- A diff library for D6, `diff` is sufficient.
- Inter + JetBrains Mono woff2 files under `static/fonts/` (A2), self-hosted, no runtime dep.
- No charting library: the existing inline SVG approach plus `Sparkline.svelte` covers
  every chart in this plan.

## 9. Decisions needed

1. **UI language:** German everywhere (recommended), or English everywhere?
2. **Light mode:** worth the half day, or stay dark-only and drop A4?
3. **Section order on mobile:** Personal Action Center first (recommended, it is the actionable
   half), or keep Intelligence Briefing first as today?
4. **Report parsing (C1):** parse the markdown structure, which couples the dashboard to the
   synthesis prompt format, or have Phase 5 additionally emit the report as structured JSON
   alongside the markdown? The second is cleaner and touches `src/pipeline/phase5-synthesis.ts`,
   which is outside this plan's scope.
5. **Search backend (D8):** Postgres `tsvector` per the no-vector-store rule, confirmed?
