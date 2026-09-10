# Dashboard Redesign Plan

Scope: `dashboard/`, plus one deliberate reach into the pipeline. Decision 4 (§9) puts the
report's structured-JSON output in `src/pipeline/phase5-synthesis.ts` and adds a column to
`daily_reports`, so this plan owns those two changes as well.

Goal is a dashboard that is pleasant to read on a phone at 06:45, and complete enough that
every table the pipeline writes has a place in the UI.

Written 2026-09-10 against commit 50f3a34 (9 pages, ~1,500 lines of Svelte, no shared
components). The decisions in §9 were settled the same day; §10 holds what was deliberately
parked for later.

---

## 1. Current state

Labels: `S*` structural, `P*` design, `X*` correctness. Work items in §2 onwards are `A*`
through `E*`, so `C2` is always a phase item and `X2` is always a bug.

### What works
- Token palette is coherent and the color choices are good (`app.css`, cerberus override).
- `[date]` prev/next/today stepping, stats bar, pipeline error card with per-attempt stack traces.
- `/[date]/detail/[ids]` is genuinely well built: extraction cards, novelty and urgency badges,
  optimistic +/- rating, deep-dive action.
- `/context-builder` is the most modern page in the app: runes, polling, progress bars, phase
  grid, and since `50f3a34` the rendered context document with collapsible source summaries.
  It is the reference for what the rest should look like, with two caveats: it still copies
  `navBtn` (S2) and still says "← Heute" (S9), and its two new `marked()` calls are unsanitized
  (X1).

### Structural problems

| # | Problem | Evidence |
|---|---|---|
| S1 | `+layout.svelte` is 5 lines (`<slot />`). Every page rebuilds its own header, wrapper and container. | `routes/+layout.svelte` |
| S2 | `const navBtn = "px-3 py-1 rounded text-xs ..."` copy-pasted verbatim in 7 files. | date, entities, notes, skills, prompts, questions, context-builder |
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
| P1 | Two parallel token systems for the same colors: Skeleton `--color-surface-*` and legacy `--bg/--text/--accent`. Any palette change must be made twice. | `app.css:13-60` |
| P2 | `font-family: "Inter"` is set but Inter is never loaded (no `@font-face`, no stylesheet link). Silently falls back to system-ui. Same for "JetBrains Mono" in code spans. | `app.css:73`, `app.html` |
| P3 | No type scale. Everything is 15px/1.6 plus per-element ad-hoc sizes. Report body is capped at `max-w-4xl` (56rem), roughly 110 characters per line: about double a comfortable reading measure. | `app.css:69-76`, `[date]/+page.svelte:168` |
| P4 | No spacing or container scale. Page paddings are `px-8 py-3`, `px-6 py-6`, `px-8 py-8`; containers are `max-w-2xl`, `3xl`, `4xl`, `5xl`, one per page, chosen arbitrarily. | all pages |
| P5 | Dark-only is intentional (decision 2), but the palette has real contrast failures under it: `surface-500` body copy on `surface-900` is **3.53:1** and `surface-600` metadata is **2.08:1**, both below the 4.5:1 AA threshold. Since there is no light mode to fall back to, these are permanent. | `app.css:14-24`, measured |
| P6 | No focus-visible styling anywhere. `focus:outline-none` appears 6 times, sometimes replaced only by a border-color change. Keyboard navigation is effectively invisible. | entities, notes, questions |
| P7 | Status conveyed by color alone: source trend is a bare arrow glyph, score is a colored number, importance is a colored word. Fails at a glance and for color-vision deficiency. | `sources/+page.svelte:7-35` |
| P8 | `/[date]` header is a non-wrapping `justify-between` flex with a 10-item nav at 12px. Guaranteed horizontal overflow on a phone, which is the primary device for this app. | `[date]/+page.svelte:93-127` |
| P9 | `/sources` table has no responsive treatment at all (6 columns, one with an inline form). `/entities` at least hides columns progressively. | `sources/+page.svelte:64` |
| P10 | PWA is a stub: one SVG icon (no 192/512 PNG, so Android install and splash degrade), `theme_color: #0f1117` does not match the real background `#111214` (visible status-bar seam), no offline cache in `sw.js`. | `static/manifest.webmanifest`, `static/sw.js` |
| P11 | The report is one flat `{@html}` blob although its structure is known and fixed by the synthesis prompts. | `[date]/+page.svelte:169-172` |

### Correctness issues found while reading

| # | Issue | Where |
|---|---|---|
| X1 | `{@html}` on `marked()` output with no sanitizer, at four sites. `marked` does not sanitize; the input is LLM output derived from ingested newsletter HTML, and for the Context Builder document, from personal mail and notes. | `[date]/+page.server.ts:83`, `detail/+page.svelte:178`, `context-builder/+page.server.ts:37` and `:44` |
| X2 | Context Builder cost is computed with `$3.00 / $15.00` per Mtok, which are Sonnet prices, applied to `gpt-5.6-luna` token counts. The number displayed is wrong. | `context-builder/+page.svelte:64-67` |
| X3 | `availableDates` (60 entries) is loaded, returned to the client, and never used. | `[date]/+page.server.ts:121` |
| X4 | Rating buttons carry `title=` but no accessible name; `+`/`−` alone is not a label. | `detail/+page.svelte:131-138` |
| X5 | "Pipeline läuft… Seite in einigen Minuten neu laden" asks the user to reload manually, while `/context-builder` already demonstrates polling in this codebase. | `[date]/+page.svelte:176` |

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
  --app-text-muted: var(--color-surface-400); /* not -500, see A4 */
}
```

Every `.report-body` rule then references `--app-*`, so a palette change happens in one place,
and the contrast fixes in A4 are a change to this block rather than a sweep through 8 pages.

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

**A4. Contrast and color correction (dark-only).**
Light mode is out (decision 2), so `color-scheme: dark` stays forced and the single palette
carries the whole load. That makes every contrast failure permanent, so they get fixed at the
token level rather than per component. Measured against the current tokens (WCAG 2.1, sRGB):

| Pair | Colors | Measured | Verdict |
|---|---|---|---|
| `surface-500` on `surface-900` | `#6b7280` on `#1a1c1f` | **3.53:1** | fails AA. This is nearly all secondary copy in the app. |
| `surface-500` on `surface-950` | `#6b7280` on `#111214` | **3.88:1** | fails AA. Same token on the page background. |
| `surface-600` on `surface-900` | `#4a4f5a` on `#1a1c1f` | **2.08:1** | fails badly, and it is used for timestamps and metadata that are meant to be read. |
| `surface-700` as text | `#2a2d33` on `#1a1c1f` | **1.24:1** | effectively invisible. Used for "no data" and the `/10` score suffix. |
| `surface-400` on `surface-900` | `#8b8f9a` on `#1a1c1f` | **5.28:1** | passes. This is the replacement for muted text. |
| `surface-200` on `surface-900` | `#d4d6db` on `#1a1c1f` | **11.74:1** | passes comfortably. Body text is fine as is. |
| `primary-400` on `surface-950` | `#4f8ef7` on `#111214` | **5.84:1** | passes. Links are fine. |
| `error-500` on `error-950` | `#e05555` on `#2a1010` | **4.75:1** | passes, but only just; it is also the `<pre>` text on its own container tone. |
| `success-500` on `success-950` | `#4caf82` on `#0f2a1e` | **5.66:1** | passes. |
| `warning-500` on `warning-950` | `#e0a020` on `#2a1e00` | **7.18:1** | passes. |

Fixes that follow:

- Re-map `--app-text-muted` from `surface-500` to `surface-400` (`#8b8f9a`). One token change
  lifts every secondary label in the app from 3.5:1 to 5.3:1.
- Re-map metadata and timestamps from `surface-600` to the same muted token. `surface-600` and
  darker become border and disabled-state colors only: never text, at any size.
- Replace `surface-700` text with muted at reduced opacity. Dimming is done with opacity on a
  passing color, never by picking a darker hue.
- Give the error card's `<pre>` a `surface-950` background so the message separates from the
  card instead of sitting on the same red tone.
- Badges keep their hues (all three pass) but go to 12.5px/500 weight with consistent `-700`
  borders: they currently read as low-contrast because of size and a same-hue 1px border,
  not because of the color pair.
- Nothing below 4.5:1 for text anywhere. 3:1 is permitted only for disabled states and
  decorative borders.
- No hue may encode meaning without a glyph or word beside it (see P7 and E6).

Keep the measured table above as a comment block in `app.css` next to the token definitions,
so a future palette edit can be re-verified. The script that produced these numbers is eight
lines; check it in as `dashboard/scripts/contrast.ts` and run it after any palette change.

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

**B1. Real root layout.** Move header, nav and page frame into `+layout.svelte`. No theme
toggle: decision 2 settles the app as dark-only.
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
`fmtElapsed`, `fmtCost`. Fixes S3 and X2 at the same time, since cost gets a single
definition with the real model prices.

**B3. Responsive navigation.** Desktop: a horizontal bar grouped as
`Report | Sources · Entities · Topics · Contacts | Notes · Rules | Skills · Prompts · Runs`.
Mobile: a bottom tab bar for the four routes used daily (Report, Topics, Notes, Search) plus
a sheet for the rest. The nav badge for pending questions and pending skills belongs here, not
inline in a link.

**B4. English everywhere** (decision 1). Every string in the chrome, every empty state, every
button, every table header. Concretely:

- Nav: `Report · Sources · Entities · Topics · Contacts · Notes · Rules · Skills · Prompts · Runs`.
- Replace the German strings: "Quellen" → Sources, "Quellenbewertung" → Source quality,
  "Heute" → Today, "Deaktivieren"/"Aktivieren" → Disable/Enable, "Bestätigen"/"Abbrechen" →
  Confirm/Cancel, "Erwähnungen" → Mentions, "Wichtigkeit" → Importance, "Zuletzt" → Last seen,
  "Aufnahmequote" → Include rate, "Verlauf" → History, "Fehlgeschlagen" → Failed,
  "Versuch n/3" → Attempt n/3, "Pipeline jetzt starten" → Run pipeline now,
  "Erneut versuchen" → Retry, "Mehr dazu" → More on this, "Tiefer eintauchen" → Go deeper,
  "Relevanz-Signal" → Relevance, "Neue Note" → New note, "Kein Report für X" → No report for X.
- DB values, scope names and status enums stay English in the database and get their display
  form from one `LABELS` map in `src/lib/labels.ts`, so `novelty: "continuation"` renders as
  "Continuation" without a second translation layer.
- Dates and numbers move from `de-DE` to `en-GB` in the shared formatters (B2): day-month-year
  order and 24-hour clock, which matches the current German output, without German month
  abbreviations. `sv-SE` stays where it is used to get an ISO date string, since that is a
  formatting trick and not a locale choice.
- `app.html` gets `lang="en"`. If the report body itself is German (the synthesis prompts do
  not pin an output language, so this needs one look at a real report), wrap only the report
  container in `lang="de"` so hyphenation and screen readers stay correct. If the report turns
  out to be English too, drop the wrapper.

---

## 4. Phase C: the report reading experience

This is where the design work pays off. The report is the product; everything else is admin.

**C1. Phase 5 emits structured JSON alongside the markdown** (decision 4). The dashboard stops
guessing at the report's shape and reads a stable contract instead.

*Where the parsing happens.* Phase 5 keeps asking the model for markdown exactly as it does
today, then parses its own output deterministically in Bun and writes both. No second Sonnet
call (CLAUDE.md forbids one for Phase 6 logic, and the same reasoning applies here), no extra
tokens, no prompt change, and no risk of degrading the prose by asking the model to emit JSON
prose. The structure is already pinned by the prompts (`## Intelligence Briefing`,
`### {Domain}`, `### Also noted`, `## Personal Action Center`, `### Critical`,
`### High priority`, `### Normal`, `### Mentions`, plus the `<!--refs:ID-->` anchors), so the
parse is a heading walk. Crucially, the parser lives next to the prompt that defines the
format, so prompt drift is a one-file fix in the pipeline rather than a silent dashboard break.

*Contract:*

```ts
type ReportJson = {
  version: 1;
  date: string;
  personal: {                                  // Section 2, rendered first (decision 3)
    urgency: "critical" | "high" | "normal" | "mentions";
    entries: Entry[];
  }[];
  intel: { domain: string; entries: Entry[] }[]; // Section 1
  alsoNoted: Entry[];
};
type Entry = { md: string; refIds: string[] };   // markdown fragment, refs stripped out
```

`md` per entry rather than pre-rendered HTML: the dashboard owns rendering and sanitization
(C2), and the pipeline stays free of `marked`.

*Storage:* new `daily_reports.report_json jsonb` column, nullable. `full_report` stays the
source of truth and is never dropped: it is what the model actually produced, and the archive
must remain readable if the parser is ever wrong. Migration is applied manually via a temp Bun
script with `new SQL(DATABASE_URL)` per the project rule, with `migrations/` and the Drizzle
schema updated for reference.

*Failure mode:* if the parse does not find both section headings, write `null` and log a note.
The dashboard falls back to rendering `full_report` as today. A prompt drift then degrades the
layout instead of emptying the page.

*Backfill:* run the parser over existing `daily_reports` rows once, as a throwaway script.
Cheap, and it means the archive (C8) is not split into pre- and post-JSON eras.

**C2. Sanitize.** Add `isomorphic-dompurify` (or `marked` + an explicit allowlist) and route
every `marked()` call through one `renderMarkdown()` helper in `src/lib/markdown.ts`. Four
call sites today (X1): the report, the deep-dive, and the two Context Builder ones added in
`50f3a34`. The Context Builder document is the most sensitive of the four, since its input is
personal mail and Keep notes rather than newsletters.

This does not depend on C1 and does not have to wait for it. If step 3 slips, pull C2 forward
into step 2: a one-file helper plus four call-site changes, and the `{@html}` surface is closed.

**C3. Personal Action Center first, single column** (decision 3). Section 2 is the actionable
half, so it leads at every viewport width, not only on mobile. No two-column body: the
reading measure from A3 is 68ch, which a side-by-side layout cannot honor on a laptop anyway.

- Order: Personal Action Center → Intelligence Briefing → Also noted.
- A sticky segmented control at the top switches between the two sections and doubles as a
  scroll indicator. On desktop the same control sits in the TOC rail (C6).
- Urgency becomes visual, not just a heading you scroll past: critical entries get a 3px left
  accent border in `--color-error-500` plus an "Critical" chip, high priority the warning hue,
  normal unadorned. Per A4, the chip text carries the meaning and the hue only reinforces it.
- If Section 2 is empty for the day, collapse it to a one-line "Nothing needs action today"
  and let the briefing take the top of the page. An empty panel above the fold is worse than
  no panel.

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
`/context-builder` progress-bar pattern. The report appears when it is ready. Fixes X5.

**C8. Archive and date picker.** `availableDates` is already loaded and unused (X3). Give it
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

**D8. Search, keyword first.** Full-text search across `daily_reports.full_report`,
`extractions`, `notes` and `entities` via Postgres `tsvector` with a GIN index and
`ts_headline` for snippets. A `⌘K`/`Ctrl+K` palette is the natural home, together with route
jumping. Store the `tsvector` as a generated column so it cannot drift from the text.

This is the shipping version. Semantic search is a real want but is parked deliberately, with
its own reasoning, in §10 - build D8 so that the parked version is an addition rather than a
rewrite: one `search()` function in `src/lib/server/search.ts` returning
`{ id, kind, title, snippet, score }[]`, with the ranking strategy behind that signature.
The UI must never know which backend produced the ranking.

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
  names on all icon buttons (fixes X4), a skip link, and a text or shape indicator alongside
  every color-coded status (fixes P7). Contrast is already handled in A4, in step 1; this step
  re-runs `contrast.ts` as a check rather than doing the remapping.
- **E7. Query parallelization.** `Promise.all` in `[date]/+page.server.ts`, and replace the
  60-row date fetch with two scalar queries for prev and next plus a separate archive endpoint
  (fixes S8).

---

## 7. Sequencing

| Step | Content | Effort | Risk |
|---|---|---|---|
| 1 | Phase A: tokens, contrast fixes (A4), fonts, scales, focus, runes migration | 1 day | low, no behavior change |
| 2 | Phase B: layout, components, nav, English pass | 1-2 days | low, large deletion of duplication |
| 3 | C1: Phase 5 JSON, `report_json` migration, parser, backfill | 0.5-1 day | medium, pipeline change |
| 4 | C2, C4: sanitize, inline rating | 1 day | medium, core render path |
| 5 | C3, C5, C6, C7, C8: section order, inline expansion, TOC, live status, archive | 1-2 days | medium |
| 6 | D1, D3, D4: topics, rules, skill approval | 1-2 days | low, additive |
| 7 | E4, E5, E6: PWA completion, push deep-links, accessibility | 0.5-1 day | low |
| 8 | C9, D2, D5, D6, D8: cost display, entity detail, runs, prompt diff, keyword search | 2-3 days | low, additive |
| 9 | E1, E2, E3, E7, D7, D9: keyboard, loading, toasts, query parallelization, contacts, feedback | 1-2 days | low |

Steps 1 and 2 are prerequisites for everything else and should not be split across sessions.
Step 3 is the only step that touches the pipeline: ship it alone, verify against one real
report plus the backfill before starting step 4. Steps 4 and 5 are the only ones that can
visibly break the report, so they get their own commit sets and are verified against a real
report on a phone, not only in a desktop viewport.

Commit granularity per the project rule: one commit per phase item, not per phase.
Run `bun run check` in `dashboard/` before each commit.

## 8. Dependencies to add

- `isomorphic-dompurify` (C2), required.
- A diff library for D6, `diff` is sufficient.
- Inter + JetBrains Mono woff2 files under `static/fonts/` (A2), self-hosted, no runtime dep.
- No charting library: the existing inline SVG approach plus `Sparkline.svelte` covers
  every chart in this plan.

## 9. Decisions (settled 2026-09-10)

1. **UI language: English everywhere.** Every string in the chrome, no mixed nav rows.
   See B4 for the string list and the locale change. DB enums stay English and are translated
   only at the display layer.
2. **Dark-only, contrast fixed.** No light mode, no toggle: A4 was rewritten from "add light
   mode" to "correct the dark palette". Since there is no second theme to fall back to, the
   measured contrast failures (3.53:1 body copy, 2.08:1 metadata, 1.24:1 for `surface-700`
   text) are permanent bugs and get fixed at the token level in step 1.
3. **Personal Action Center first**, at all viewport widths, single column. See C3.
4. **Phase 5 emits structured JSON alongside the markdown.** New nullable
   `daily_reports.report_json`, deterministic parse in Bun, no extra AI call, markdown retained
   as the source of truth, with a fallback to today's rendering if the parse fails. See C1.
   This is the one item in this plan that changes the pipeline.
5. **Search: Postgres `tsvector` now, semantic search parked.** See D8 for what ships and §10
   for the parked idea and what it would cost to unpark it.

---

## 10. Parked: semantic search over the archive

Parked deliberately on 2026-09-10, not rejected. It belongs after D8 ships and after the
pipeline has produced enough archive to search: below roughly 60 reports, keyword search wins
on precision and there is nothing for embeddings to generalize over.

### Why it is wanted

Keyword search finds the report that used a word. It cannot find "that thing about export
controls from a few weeks ago" when the report said "chip restrictions", and it cannot answer
"what have I read about this entity's suppliers" at all. Two of the system's stated goals -
continuity across days and compounding value from the archive - are exactly the queries
`tsvector` is worst at. The archive grows by ~1,000 words a day, so the gap widens.

### Conflict to resolve first

`CLAUDE.md` states, under non-negotiable architecture rules:

> **No vector stores.** Decided, not revisiting. All retrieval is explicit keyword/entity
> lookup against Postgres.

`CONTEXT_AND_DECISIONS.md` carries the rationale. This plan does not silently override that.
Unparking requires editing both documents first, with a dated note recording what changed,
in the same style as the 2026-09-10 credentials/diary narrowing. Until that happens, D8 is the
only search that ships.

Note the rule's second half is not in conflict at all: pgvector inside the existing Postgres
is not a vector *store* in the sense the rule was written against (a separate service, a second
source of truth, opaque retrieval). Keeping it as one more index in the same database, behind
the same `search()` signature, is arguably within the spirit of the rule. That is the argument
to have when unparking, and it is a documentation decision, not a technical one.

### Shape it should take, when it happens

- **pgvector in the existing Postgres.** No second service, no second source of truth, nothing
  leaves the machine that does not already leave it.
- **Local embeddings.** Ollama is already the intended extraction runtime; an embedding model
  there keeps archive content off a cloud API, which matters because the archive contains
  personal-section content. If Ollama proves unreliable for this, as it did for Context Builder
  extraction, the alternative is an OpenAI embeddings call with `store: false`, which is a
  privacy decision to make explicitly, not by default.
- **Hybrid ranking, not replacement.** Keyword and vector results merged (reciprocal rank
  fusion is enough), because exact-match queries must stay exact. Keyword-only remains the
  fallback if embeddings are missing for a row.
- **Embed entries, not whole reports.** `report_json` from C1 already splits the report into
  entries with `refIds`, which is the natural chunk: one entry, one embedding, one link back to
  its extractions. This is the strongest argument for doing C1 first and for keeping `md` per
  entry.
- **Backfill offline.** A one-shot script over the archive, same pattern as the C1 backfill.
- **Behind the existing signature.** `search()` from D8 gains a strategy; the UI does not change.

### What it unlocks beyond search

- "Related reports" on an entity detail page (D2) and on a topic (D1).
- Near-duplicate detection for novelty scoring, which currently relies on keyword overlap.
- Retrieval for a future "ask my archive" view, which is the obvious next feature once the
  archive is a year deep.

Cost estimate when unparked: one day for pgvector plus embedding pipeline plus backfill, half
a day for hybrid ranking, assuming D8 and C1 already shipped.
