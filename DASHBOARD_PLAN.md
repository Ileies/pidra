# Dashboard Redesign Plan

## Status: executed 2026-09-12, except M-9

Everything below shipped in one pass on 2026-09-12, from `3939e93`. The plan text is kept as
written - it is the record of why each change was made, and the commit messages reference its
item numbers - so read it as the argument, not as an outstanding to-do list.

| Phase | State |
|---|---|
| A1-A6 | Done. One token source, self-hosted Inter and JetBrains Mono, type and container scales, full accent ramps, contrast fixed at the token level, global focus ring and reduced-motion block, runes migration finished. `dashboard/scripts/contrast.ts` runs as part of `bun run check`. |
| B1-B4 | Done. `<Page>`, twelve shared components, `$lib/format.ts`, `$lib/labels.ts`, `$lib/routes.ts`, English everywhere. `scripts/check-route-surfaces.ts` fails the root build when the registry and `src/ai/surfaces.ts` disagree, which is what closes S11 rather than documenting it. |
| M-1 - M-8 | Done. Grouped desktop nav, mobile bottom tab bar and More sheet, `tap`/`tap-check`/`input-base`, cards-or-scroll tables, `dvh`, safe areas, a measured `--header-h`, the assistant as a tab below `sm`, and a PWA that installs and caches the last seven reports. |
| **M-9** | **Not done.** See below. |
| C1-C9 | Done. `report_json` with a deterministic parser in the pipeline and a backfill over all four existing reports, sanitised markdown, Personal Action Center first, inline rating, inline expansion, section nav, live run status, the archive picker, cost on the stats bar. |
| D1-D9 | Done. `/topics`, `/entities/[id]`, `/rules`, the skill approval queue, `/runs`, prompt diffs, `/contacts`, keyword search behind `search()`, `/feedback`. |
| E1-E7 | Done. Keyboard shortcuts with the Ctrl+K collision settled (search takes it, the assistant moves to Ctrl+J), loading states, one toast store, push deep-links, accessibility pass, query parallelisation. |

**M-9 is the one item that cannot be closed from here, and decision 6 makes it a gate.** Every
number in §2 is derived from class lists rather than measured on hardware, and nothing in this
pass has been opened on a phone. What is verified: `bun run check` clean in both packages, the
production build succeeds, every route returns 200 against the real database, and the parser has
unit tests. What is not: the 52px header claim, tap targets under a thumb, focus without zoom in
iOS Safari, each table at 390px, `/chat` with the keyboard open, landscape, the assistant panel
surviving a navigation mid-turn, the notes toast and undo, and an offline load of yesterday's
report as an installed PWA. Until that pass happens, treat Phase M as written-but-unverified.

One deviation worth naming: cost is not hardcoded. The plan says to give `fmtCost` "the real
`gpt-5.6-luna` prices"; those prices are not in this repository and inventing them would replace
one confidently wrong number (X2) with another. `PUBLIC_MODEL_PRICE_IN_PER_MTOK` and
`PUBLIC_MODEL_PRICE_OUT_PER_MTOK` in the shared `.env` supply them, and every cost in the UI
renders as unavailable, with the reason, until they are set.

---

Scope: `dashboard/`, plus one deliberate reach into the pipeline. Decision 4 (§11) puts the
report's structured-JSON output in `src/pipeline/phase5-synthesis.ts` and adds a column to
`daily_reports`, so this plan owns those two changes as well.

Goal is a dashboard that is pleasant to read on a phone at 06:45, and complete enough that
every table the pipeline writes has a place in the UI.

First written 2026-09-10 against `50f3a34`: 9 pages, ~1,500 lines of Svelte, no shared
components, no root layout. Revised 2026-09-12 against `2ad015d`: 12 pages, ~3,270 lines of
Svelte plus ~2,100 lines of route and lib TypeScript, a real root layout with a shared navbar
and app icon, a floating assistant on every page, and a full-screen `/chat`. §1 records what
shipped in between and what the new surface area broke. §2 is the mobile audit, which the
first draft carried only as two scattered bullets and which is now the largest open problem
in the app.

---

## 1. Current state

Labels: `S*` structural, `P*` design, `X*` correctness, `M*` mobile (§2). Work items are `A*`
through `E*` plus the new `M-*` phase, so `C2` is always a phase item and `X2` is always a bug.

### What works

- Token palette is coherent and the color choices are good (`app.css`, cerberus override).
- `[date]` prev/next/today stepping, stats bar, pipeline error card with per-attempt stack traces.
- `/[date]/detail/[ids]`: extraction cards, novelty and urgency badges, optimistic +/- rating,
  deep-dive action.
- `/context-builder` is still the most modern page: runes, polling, progress bars, phase grid,
  the rendered context document with collapsible source summaries, and the corrections list.
- `/sources/[name]` (new, `69ee401`) is the best-argued page in the app: it shows the numbers
  behind a source's score, every delivery and what extraction made of each, and the
  enable/disable decision sits next to the evidence for it.
- `/skills` (new shape, `58162ff`) is a real registry editor: search, risk filter with counts,
  expandable rows, per-skill enable, risk level, description and parameter descriptions, and a
  reset-to-default when a row is overridden.
- The floating assistant is the one genuinely mobile-aware component in the codebase: it goes
  full-screen (`inset-0`) below `sm` and windowed above it.

### Shipped since the first draft

| Change | Commit | Effect on this plan |
|---|---|---|
| Navbar moved into the root layout | `044b561` | Closes S1 (partly), S2, S6, S7. B1 is now half done. |
| `nav-btn` promoted to a Tailwind `@utility` | `044b561` | Closes S2 outright; `app.css:9-23`. |
| App icon in the header, links home | `ff57c91` | Keep. See decision 8. |
| Floating assistant + `/chat` full screen | see `TODO.md` | New surface, new mobile problems (M7, M11). |
| Per-source detail page | `69ee401` | Partly fills the `source_daily_scores` gap. |
| Dashboard-editable skill registry | `58162ff` | Does **not** close D4: still no confirm/reject for `pending`. |
| Speech-bubble launcher icon | `7d2d9d7` | Keep; it is the only 44px-plus touch target in the app. |
| `jsonb` double-encoding fix | pipeline side | Unblocks C1 (`report_json`) and D8 (`tsvector`). |

### Structural problems

| # | Problem | Status as of `2ad015d` |
|---|---|---|
| S1 | `+layout.svelte` was 5 lines; every page rebuilt its own header. | **Closed.** The layout owns the navbar and the shell. What is left is S10. |
| S2 | `navBtn` copy-pasted in 7 files. | **Closed.** One `@utility` plus four modifiers. |
| S3 | 5 local `fmtDate` implementations. | **Open, and worse.** 16 local formatters across 8 files: `fmtDate` ×4 with four different option sets, plus `fmtDay`, `fmtTs` ×2, `fmtNum` ×2, `fmtScore` ×2, `fmtPct` ×2, `fmtCost`, `fmtElapsed`. |
| S4 | `src/lib/` held no UI. | **Partly closed.** `lib/components/Navbar.svelte`, `lib/notes/NoteCard.svelte`, `lib/assistant/*`. Still no Badge, Table, EmptyState, Stat or Spinner primitive; `badge` is an ad-hoc class plus a colour map in 5 files. |
| S5 | Svelte 4 and 5 APIs mixed. | **Mostly closed, 3 files left:** `sources/+page.svelte`, `entities/+page.svelte`, `questions/+page.svelte` still use `export let`, `$:` and `on:click`. |
| S6 | Nav only on `/[date]`. | **Closed.** |
| S7 | `/prompts` unreachable. | **Closed.** It is in `LINKS`. |
| S8 | `[date]/+page.server.ts` runs 4 sequential queries and fetches 60 dates. | **Open.** Still sequential (`+page.server.ts:42-80`). `availableDates` now feeds prev/next server-side, but all 60 entries are still serialised to the client, where nothing reads them. |
| S9 | UI language mixed per page. | **Open, and wider.** The navbar mixes "Quellen" with "Entities / Notes / Skills / Prompts / Chat"; `/skills` and `/questions` are fully English, `/notes`, `/sources`, `/sources/[name]`, `/chat` and the assistant are fully German. Every surface added since the draft shipped German. |
| S10 | **New.** The page frame is duplicated 10 times: `<div class="flex flex-1 flex-col min-h-0"><main class="max-w-{2,3,4,5,6}xl w-full mx-auto px-{6,8} py-{6,8} pb-16">`. Seven different container widths, two paddings, chosen per page. | Open. Phase B, M-2. |
| S11 | **New.** Routes are declared twice with no shared source: `LINKS` in `Navbar.svelte` and the surface map in `src/ai/surfaces.ts`. A new page must be added in both, and a page missed in the second one silently falls back to the `global` surface, which is a capability decision made by omission. | Open. Phase B. |
| S12 | **New.** The navbar is one flat row of ten controls (twelve on a report date) with no grouping, no priority and no overflow strategy. It is the direct cause of M1. | Open. Phase M. |

### Design problems

| # | Problem | Evidence |
|---|---|---|
| P1 | Two parallel token systems for the same colors: Skeleton `--color-surface-*` and legacy `--bg/--text/--accent`. Any palette change must be made twice, and `.report-body` is still driven entirely by the legacy block. | `app.css:30-78` |
| P2 | `font-family: "Inter"` is set but Inter is never loaded (no `@font-face`, no stylesheet link). Silently falls back to system-ui. Same for "JetBrains Mono" in code spans. | `app.css:91`, `app.html` |
| P3 | No type scale. Everything is 15px/1.6 plus per-element ad-hoc sizes. Report body is capped at `max-w-4xl` (56rem), roughly 110 characters per line: about double a comfortable reading measure. | `app.css:87-94`, `[date]/+page.svelte:75` |
| P4 | No spacing or container scale. See S10 for the current count. | all pages |
| P5 | Dark-only is intentional (decision 2), but the palette has real contrast failures: `surface-500` body copy on `surface-900` is **3.53:1** and `surface-600` metadata is **2.08:1**, both below the 4.5:1 AA threshold. Since there is no light mode to fall back to, these are permanent. | `app.css:32-42`, measured |
| P6 | No focus-visible styling anywhere except the assistant launcher. `focus:outline-none` appears 10 times, usually replaced only by a border-color change. Keyboard navigation is effectively invisible. | entities, notes, questions, skills, sources, assistant |
| P7 | Status conveyed by color alone: source trend is a bare arrow glyph, score is a colored number, importance is a colored word, skill risk is a 6px colored dot, an overridden skill is a 6px primary dot whose only explanation is a `title=`. | `sources/+page.svelte:20-48`, `skills/+page.svelte:15-20,146` |
| P8 | The header no longer overflows horizontally (the nav got `flex-wrap`), but it now overflows *vertically*: on a phone it wraps into six to eight rows. See M1, which supersedes this entry. | `Navbar.svelte:127-190` |
| P9 | Three of four data tables have no responsive treatment at all. See M4. | sources, sources/[name], skills |
| P10 | PWA is a stub. See M12. | `static/manifest.webmanifest`, `static/sw.js` |
| P11 | The report is one flat `{@html}` blob although its structure is known and fixed by the synthesis prompts. | `[date]/+page.svelte:76-79` |

### Correctness issues

| # | Issue | Where |
|---|---|---|
| X1 | `{@html}` on `marked()` output with no sanitizer, at four sites. `marked` does not sanitize; the input is LLM output derived from ingested newsletter HTML, and for the Context Builder document, from personal mail and notes. | `[date]/+page.server.ts:80`, `[date]/detail/[ids]/+page.server.ts:113`, `context-builder/+page.server.ts:41` and `:48` |
| X2 | Context Builder cost is computed with `$3.00 / $15.00` per Mtok, which are Sonnet prices, applied to `gpt-5.6-luna` token counts. The number displayed is wrong, and it is the only cost figure in the app. | `context-builder/+page.svelte:114-117` |
| X3 | `availableDates` (60 entries) is returned to the client and never read there. Narrower than in the first draft, since the server now uses it for prev/next, but the payload is still dead weight. | `[date]/+page.server.ts:118` |
| X4 | Rating buttons carry `title=` but no accessible name; `+`/`−` alone is not a label. | `detail/+page.svelte:157-164` |
| X5 | "Pipeline läuft… Seite in einigen Minuten neu laden" and "Pipeline gestartet. Seite in ~5 Min. neu laden." ask the user to reload manually, while `/context-builder` already demonstrates polling in this codebase. | `[date]/+page.svelte:83,143` |
| X6 | **New.** `/notes` pins its bulk-action bar at `sticky top-14`, a hard-coded 56px that matches the desktop header height only. With the wrapped mobile header (M1) the bar sits underneath it. Nothing derives a sticky offset from the real header height. | `notes/+page.svelte:329` |
| X7 | **New.** `Navbar.svelte` renders the pending-questions link with `animate-pulse` unconditionally, with no `prefers-reduced-motion` guard, on a permanently visible element. | `Navbar.svelte:176` |

### Functional gaps: tables written by the pipeline with no UI

| Table | Status |
|---|---|
| `active_topics` | No UI. Story continuity is the core value of the system and is invisible. |
| `contacts` | No UI, although the question gate exists to enrich it. |
| `standing_context` | Read-only inside the Context Builder document. No curation UI, although the entire point is that the user curates the rules injected into Section 2. |
| `entity_relations` / `entity_appearances` | No UI. `/entities` is a flat table with no detail page, no edges, no timeline. |
| `feedback_events` | Aggregated per source on `/sources/[name]` (`+n / −m`). Still no list of what was rated or whether it changed anything. |
| `source_daily_scores` | Now a real table on `/sources/[name]`. Still an unlabeled dot scatter with no axis, values or tooltip on `/sources` itself. |
| `pipeline_runs` | Error card only appears on a date with no report. Successful run timings and step breakdown are invisible; there is no run history. |
| `skill_executions` (status `pending`) | CLAUDE.md specifies that `high`-risk skills wait for manual confirmation. `/skills` gained a registry editor but still has no confirm or reject control, so the documented approval workflow still has no UI. |
| skill registry overrides | A changed row is marked with a 6px dot and a `title=`. There is no view of what was changed from the default, by whom, or when. |
| `prompt_versions` | `/prompts` shows full prompt text in a `<pre>` with no diff against the active version. Approval is blind. |
| `daily_reports` archive | No date picker, no archive list, no cross-report search. |
| cost | Tokens shown on `/[date]`, cost never derived. The one cost figure that exists (`/context-builder`) is wrong (X2). |

---

## 2. Mobile: the audit

The stated use case is a phone at 06:45. The app has never been opened on one, and it shows.

**Measured coverage.** Of the 17 `.svelte` files under `routes/` and `lib/`, 12 contain zero
responsive class prefixes. The five that contain any: `Assistant.svelte` (10), `entities`
(6), `chat` (3), `context-builder` (2), `sources/[name]` (2). Two files use `overflow-x-auto`.
No file uses `dvh`, `env(safe-area-inset-*)`, a container query, or a `min-h-11`-class touch
target.

**Reference viewports.** 390×844 CSS px (iPhone 14/15 class) and 360×800 (mid-range Android).
Every number below is at 390 unless stated. The numbers are derived from the class lists, not
measured on hardware; confirming them on a real device is the first task of Phase M (M-9).

### Cross-cutting defects

**M1. The navbar eats a fifth of the viewport.** The header is
`flex justify-between gap-4 px-8`, with a `shrink-0` logo block and a `flex-wrap` nav. At 390px
the content box is 326px; the logo, title and subtitle claim roughly 195px of it, leaving the
nav about 115px per row. The nav's ten controls (twelve on a report date, once the prev/next
day steppers appear) have an intrinsic width of roughly 730px, "Context Builder" alone being
about 120px. That wraps to six to eight rows of ~26px, so the sticky header is 150-200px tall
on every page before the status bar and safe area are counted. This is the single worst mobile
defect and the reason M8 and X6 exist.

**M2. Nothing meets the minimum touch target.** iOS HIG asks for 44×44pt, Material for 48dp.
Current sizes: `nav-btn` is `px-3 py-1 text-xs`, about 22px tall. Rating buttons are `w-7 h-7`,
28px. Table action buttons (`Deaktivieren`, `Bestätigen`, `Abbrechen`, skill `Save`) are
`px-2.5 py-1`, about 24px. Selection checkboxes are browser-default, about 13px, and in
`/notes` they sit inside a row of controls. The only compliant control in the app is the
assistant launcher at 56px.

**M3. Every input zooms iOS Safari on focus.** Mobile Safari zooms the viewport whenever a
focused input's computed font-size is below 16px, and does not zoom back out afterwards. Every
input in the app is `text-xs` (12px) or `text-sm` (14px): the notes search and composer, the
entities filter, the source filter and disable-reason fields, the skills search and every field
of the skill editor, the questions textareas, the assistant composer. So the first tap into any
field leaves the user on a zoomed, horizontally panning page.

**M4. Three of four tables neither fit nor scroll.** `/sources` is six columns including a
128px inline text input and a three-button confirm dance, with no `overflow-x` wrapper, so the
whole page pans. `/sources/[name]` has a six-column daily-score table inside a `<details>`,
same problem. `/skills` has two four-column tables plus an edit form inside a `colspan="4"` row
whose fields are fixed-width (`w-44`, `w-32`). Only `/entities` does this right, with
`overflow-x-auto` plus `hidden sm:table-cell` / `md` / `lg` progressive columns, and it is the
template for M-5.

**M5. Page padding costs 16% of the screen.** `px-8` (64px) on eight pages, `px-6` (48px) on
three. No page uses a responsive padding. Combined with `max-w-4xl` on the report, the reading
column on a phone is 326px of a 390px screen with no benefit from the lost 64.

**M6. `100vh` is wrong on mobile.** `+layout.svelte` applies `h-screen` on `/chat` and
`min-h-screen` everywhere else. Mobile browser chrome makes `100vh` taller than the visible
area, so the `/chat` composer sits below the fold behind the URL bar. Needs `dvh`.

**M7. No safe-area handling.** `env(safe-area-inset-*)` appears nowhere and `viewport-fit=cover`
is not set in `app.html`. The assistant launcher (`fixed bottom-5 right-5`) and the notes undo
toast (`fixed bottom-6 left-1/2`) both land on or beside the iOS home indicator, and the toast
sits directly under the launcher's thumb path.

**M8. Sticky offsets are hard-coded to the desktop header.** `sticky top-14` in `/notes`
assumes 56px. With M1's wrapped header the bulk-action bar is hidden underneath it. Any future
sticky element inherits the same bug because there is no `--header-h` to reference (X6).

**M9. The report body has no mobile treatment.** `max-w-4xl px-8`, tables in `.report-body`
with no overflow container (a markdown table in a report will pan the page), `mehr-dazu` chips
at `0.75em` with `0.05em` vertical padding, which is a sub-20px tap target on the single most
important action in the report.

**M10. The stats bar wraps badly.** Five to seven items separated by `·` glyphs that are
themselves flex children, at `text-xs`, with `flex-wrap`. On a phone it becomes three rows with
separators orphaned at the start and end of lines.

**M11. `/chat` stacks three scrollers inside a `100vh` box.** The grid collapses below `lg`
into `order-1` transcript, `order-2` conversation list, `order-3` corrections, all inside the
layout's `h-screen` flex column. Each pane keeps its own `overflow-y-auto`, so the phone gets
three independently scrolling regions where there is room for one, and the transcript's share
of the height is whatever is left over.

**M12. The PWA does not install properly and stores nothing.** One SVG icon: Android needs
192 and 512 PNG for the install prompt and the splash screen, plus a maskable variant.
`theme_color: #0f1117` against a real body background of `#111214` leaves a visible seam at the
status bar. `sw.js` handles push and notification clicks and caches nothing, so the briefing is
unreadable without a LAN connection, which is most of the point of a PWA on a phone. The
manifest description is German while the target UI language is English (decision 1), and there
are no `shortcuts`.

**M13. Hover-only affordances.** The `/sources` source name explains itself through `title=`,
skill and execution rows reveal their state through `hover:bg`, `mehr-dazu` only looks like a
link on hover, and the overridden-skill dot and the risk dot are `title=` only. None of this
exists on a touch device.

### Per route

| Route | What breaks at 390px | Worst of it |
|---|---|---|
| `/[date]` | M1, M5, M9, M10; report tables pan; "Mehr dazu" is a sub-20px target | The primary page of the app |
| `/[date]/detail/[ids]` | M1, M2 (28px rating buttons), M5; raw-email `<pre>` inside `max-h-96` scroller nested in the page scroller | Rating is the calibration loop (C4) |
| `/sources` | M1, M4 (worst case: 6 columns plus an inline form), M2, M13 | Page pans horizontally |
| `/sources/[name]` | M1, M4 (daily table), M5; the stat grid is `grid-cols-2` and works | Otherwise the best-built page |
| `/entities` | M1, M3, M5 | Already responsive; only the shell and inputs fail |
| `/notes` | M1, M8/X6 (bulk bar hidden), M2 (checkboxes), M3, M7 (toast under the launcher), M5 | Toast and launcher collide |
| `/skills` | M1, M4 (two tables plus a fixed-width edit form), M2, M3, M13 | Registry editing is unusable |
| `/prompts` | M1, M5; `<pre>` blocks are `whitespace-pre-wrap` so they at least wrap | Least broken |
| `/questions` | M1, M3, M5 | Time-boxed task done on a phone |
| `/context-builder` | M1, M5; grids are already `grid-cols-2 sm:grid-cols-*` | Mostly fine |
| `/chat` | M1, M6, M11, M3 | Three scrollers in a wrong-height box |
| Assistant widget | Correct below `sm` (`inset-0`), but the launcher collides with M7 and with any bottom bar | The one thing to keep |

---

## 3. Phase A: design foundation

The prerequisite for everything else. No visible feature work, one commit per item, low risk.

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
and the contrast fixes in A4 are a change to this block rather than a sweep through 12 pages.

**A2. Type scale + real fonts.**
Self-host Inter (variable) and JetBrains Mono under `static/fonts/` with `@font-face` and
`font-display: swap`. No CDN: the dashboard runs on the LAN and should not depend on external
hosts. Define a scale as tokens (`--text-xs` … `--text-2xl`), set `font-feature-settings`
for tabular numbers on the stat classes, and set the report measure to `max-w-[68ch]`
instead of `max-w-4xl`.

The scale has a mobile floor: no interactive control and no form field may resolve below 16px
at `<sm`, which is what closes M3. Reading text may go to 15px; labels and metadata may go to
13px; neither is ever a focus target.

**A3. Spacing and container scale.**
Three container widths only: `--w-read` (68ch, report and detail), `--w-app` (72rem, tables),
`--w-form` (40rem, questions and forms). One page padding rule, responsive:
`px-4 sm:px-6 lg:px-8`. Codify in `src/lib/ui/layout.ts` as exported class constants, consumed
by the `<Page>` primitive from M-2. This retires the seven ad-hoc widths counted in S10.

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
- No hue may encode meaning without a glyph or word beside it (see P7, M13 and E6). This now
  covers the 6px risk dot and the 6px override dot on `/skills`.

Keep the measured table above as a comment block in `app.css` next to the token definitions,
so a future palette edit can be re-verified. The script that produced these numbers is eight
lines; check it in as `dashboard/scripts/contrast.ts` and run it after any palette change.

**A5. Focus and motion.**
Global `:focus-visible` ring (2px, `--color-primary-400`, 2px offset), copying what
`Assistant.svelte` already does. Remove every `focus:outline-none` that is not paired with a
replacement ring; there are 10. Wrap `animate-pulse`, `animate-bounce` and all transitions in
`@media (prefers-reduced-motion: reduce)`, which also fixes X7.

**A6. Finish the runes migration.**
Three files left: `sources`, `entities`, `questions`. `export let` → `$props()`, `on:click` →
`onclick`, `$:` → `$derived` or `$effect`. Mechanical, and it removes the last reason a shared
component cannot be dropped into those pages. Run `bun run check` after.

---

## 4. Phase B: application shell

The layout landed in `044b561`; the components it should be made of did not.

**B1. Finish the shell.** The root layout owns the navbar already. What remains: a `<Page>`
primitive that owns the `flex flex-1 flex-col min-h-0` wrapper, the container width and the
responsive padding, so the ten hand-rolled copies (S10) collapse into
`<Page size="read|app|form">`. No theme toggle: decision 2 settles the app as dark-only.

**B2. Component library** in `src/lib/components/`:

| Component | Replaces |
|---|---|
| `Page.svelte` | 10 hand-built page frames (S10) |
| `Badge.svelte` | ad-hoc `badge` + class-map objects in 5 files |
| `StatBar.svelte` / `StatCard.svelte` | the inline stats row on `[date]`, the stat grid on `/sources/[name]`, the counters on `/context-builder` |
| `DataTable.svelte` | sources, sources/[name], skills and entities tables, with one responsive strategy (M-5) |
| `EmptyState.svelte` | 8 one-off centered paragraphs |
| `ErrorCard.svelte` | the pipeline error card, reusable for context-builder errors |
| `Sparkline.svelte` | the raw SVG dot scatter, with axis, min/max labels and title |
| `ConfirmButton.svelte` | the inline confirm dance, now duplicated in `/sources` and `/sources/[name]` |
| `Toast.svelte` | the notes toast, currently the only one, so the store has one caller to start with |
| `Spinner.svelte` / `Skeleton.svelte` | the "loading…" text swaps |

`AppHeader` and `NavBar` are dropped from the original list: the navbar exists and the header
is part of the layout. It is rebuilt responsively in M-1 instead.

Plus `src/lib/format.ts`: one `fmtDate`, `fmtDateTime`, `fmtNum`, `fmtPct`, `fmtScore`,
`fmtElapsed`, `fmtCost`. Deletes the 16 local formatters (S3) and fixes X2 at the same time,
since cost gets a single definition with the real `gpt-5.6-luna` prices, read from one constant
next to the model id.

**B3. One route registry.** A single `src/lib/routes.ts` that names every page, its label, its
icon, its nav group and its assistant surface. The navbar renders from it and
`src/ai/surfaces.ts` validates against it, so adding a page cannot silently produce a `global`
surface (S11). The registry is also what M-1's bottom bar and overflow sheet read.

**B4. English everywhere** (decision 1). Every string in the chrome, every empty state, every
button, every table header. The surface has grown since the first draft, so the list is bigger:

- Nav: `Report · Sources · Entities · Topics · Contacts · Notes · Rules · Skills · Prompts · Runs · Chat`.
- Replace the German strings: "Quellen" → Sources, "Quellenbewertung" → Source quality,
  "Quellen-Beiträge" → Deliveries, "Heute" → Today, "Deaktivieren"/"Aktivieren" →
  Disable/Enable, "Bestätigen"/"Abbrechen" → Confirm/Cancel, "Erwähnungen" → Mentions,
  "Wichtigkeit" → Importance, "Zuletzt" → Last seen, "Aufnahmequote" → Include rate,
  "Verlauf" → History, "Fehlgeschlagen" → Failed, "Versuch n/3" → Attempt n/3,
  "Pipeline jetzt starten" → Run pipeline now, "Erneut versuchen" → Retry,
  "Mehr dazu" → More on this, "Tiefer eintauchen" → Go deeper, "Relevanz-Signal" → Relevance,
  "Neue Note" → New note, "Papierkorb" → Trash, "Rückgängig" → Undo,
  "Kein Report für X" → No report for X, "Lieferungen" → Deliveries,
  "Beiträge" → Items, "Übersprungen" → Skipped, "keine Daten" → No data.
- The assistant is chrome too: "Assistent" → Assistant, "Neuer Chat" → New chat,
  "Senden" → Send, "Stopp" → Stop, "Vollbild" → Full screen, "Aktive Korrekturen" → Active
  corrections, "Was soll geändert werden?" → What should change?, and the page digests in every
  `setPageContext` call. The digests are model input, not UI, but they should match the UI
  language so the model answers in it.
- DB values, scope names and status enums stay English in the database and get their display
  form from one `LABELS` map in `src/lib/labels.ts`, so `novelty: "continuation"` renders as
  "Continuation" without a second translation layer. The per-page label maps in
  `sources/[name]`, `skills`, `entities` and `chat` fold into it.
- Dates and numbers move from `de-DE` to `en-GB` in the shared formatters (B2): day-month-year
  order and 24-hour clock, which matches the current German output, without German month
  abbreviations. `sv-SE` stays where it is used to get an ISO date string, since that is a
  formatting trick and not a locale choice.
- `app.html` gets `lang="en"`, and the manifest name and description follow (M-8). If the
  report body itself is German, wrap only the report container in `lang="de"` so hyphenation
  and screen readers stay correct.

---

## 5. Phase M: mobile

New phase, and the one the current state of the app most needs. It is deliberately placed
before the report work in §6, because the report work has to be verified on a phone anyway and
there is no point verifying it against a shell that is itself broken there.

**M-1. Responsive navigation.** The navbar is rebuilt from the route registry (B3):

- **Desktop (`sm` and up):** one horizontal bar, grouped rather than flat:
  `Report | Sources · Entities · Topics · Contacts | Notes · Rules | Skills · Prompts · Runs`.
  Pending badges (questions, pending skill executions) sit on the group, not inline as an
  extra link.
- **Mobile:** the top bar keeps only the app icon (home), the page title and one overflow
  button. Everything else moves to a fixed bottom tab bar with four destinations: Report,
  Notes, Chat and More, where More opens a sheet listing the rest of the registry with its
  badges. The day steppers move out of the navbar and into the report page itself, as two
  large targets beside the date.
- The bottom bar is `h-14` plus `env(safe-area-inset-bottom)`, and every tab is a full-height
  target, which is the first thing in the app to satisfy M2.

This alone takes the mobile header from 150-200px down to about 52px and gives back roughly a
fifth of the viewport on every page.

**M-2. Page frame.** Ship `<Page>` from B1 with `px-4 sm:px-6 lg:px-8` and the three container
widths from A3. Closes M5 and S10 together. Every page's top-level markup becomes one element.

**M-3. Touch targets.** A `tap` utility in `app.css`
(`min-height: 2.75rem; min-width: 2.75rem` below `sm`, current size above) applied to every
button, link-button, select, checkbox row and icon button. Specifically: `nav-btn` gains a
mobile size, the rating buttons go from `w-7 h-7` to 44px, the confirm/cancel dances become
stacked full-width buttons below `sm`, and selection checkboxes get a padded label wrapper
rather than a bare 13px box.

**M-4. Inputs at 16px on mobile.** One `input-base` class, `text-base sm:text-sm`, replacing
the per-page `inputClass` constants. No `maximum-scale=1` in the viewport meta: suppressing
zoom to work around M3 would break accessibility zoom, and the font-size fix is the correct
one. Closes M3.

**M-5. Tables become cards below `md`.** `DataTable` (B2) renders a stacked card list on small
screens and a table above, with per-column "show at" metadata so a dense numeric table can
instead use the `/entities` strategy (`overflow-x-auto` plus progressive `hidden sm:table-cell`).
Per table:

| Table | Below `md` |
|---|---|
| `/sources` | Card per source: name, score, trend, include rate, sparkline, one action button |
| `/sources/[name]` daily scores | Keep the table, wrap in `overflow-x-auto`, hide the two least useful columns |
| `/skills` registry | Card per skill; the edit form becomes a full-width sheet rather than a `colspan` row |
| `/skills` executions | Card per execution |
| `/entities` | Already correct; only move it onto the shared component |

**M-6. Viewport units, safe areas and sticky offsets.** `h-dvh`/`min-h-dvh` in the layout,
`viewport-fit=cover` in `app.html`, a `--safe-b` token, and a `--header-h` CSS variable set by
the layout that every sticky element references (`top-[var(--header-h)]`). Closes M6, M7, M8
and X6. The notes toast moves above the bottom bar and the safe area.

**M-7. The assistant on mobile.** Below `sm` the floating launcher is replaced by a Chat tab in
the bottom bar; the panel already renders full-screen there, so nothing about the panel changes.
Above `sm` the launcher stays exactly as it is. This removes the launcher/toast/home-indicator
collision (M7) instead of working around it, and it means one fewer floating element on a 390px
screen. See decision 7.

**M-8. PWA for real.** PNG icons at 192 and 512 plus a maskable variant generated from the
existing SVG, `theme_color` corrected to `#111214`, `background_color` to match,
`display_override: ["standalone"]`, English name and description (B4), `shortcuts` to Report /
Notes / Chat, and a service-worker cache of the shell plus the last 7 report pages so the
briefing is readable offline. Closes M12 and subsumes the old E4.

**M-9. Verify on real hardware.** Not optional, and not a desktop-viewport resize: iOS Safari
and Android Chrome, 390×844 and 360×800, in the browser and as an installed PWA. The checklist:
the header height claim in M1; every tap target; focus without zoom in every input; each of the
four tables; `/chat` with the keyboard open; landscape; the assistant panel surviving a
navigation mid-turn; the notes toast and undo; offline load of yesterday's report. `TODO.md`
already carries an open item saying the assistant has never been clicked through in a browser
at all: that item is discharged here.

---

## 6. Phase C: the report reading experience

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
schema updated for reference. The `jsonb` double-encoding fix has landed, so the column behaves
as real `jsonb` from the first row.

*Failure mode:* if the parse does not find both section headings, write `null` and log a note.
The dashboard falls back to rendering `full_report` as today. A prompt drift then degrades the
layout instead of emptying the page.

*Backfill:* run the parser over existing `daily_reports` rows once, as a throwaway script.
Cheap, and it means the archive (C8) is not split into pre- and post-JSON eras.

**C2. Sanitize.** Add `isomorphic-dompurify` (or `marked` + an explicit allowlist) and route
every `marked()` call through one `renderMarkdown()` helper in `src/lib/markdown.ts`. Four
call sites today (X1): the report, the deep-dive, and the two Context Builder ones. The Context
Builder document is the most sensitive of the four, since its input is personal mail and Keep
notes rather than newsletters.

This does not depend on C1 and does not have to wait for it. If the C1 step slips, pull C2
forward: a one-file helper plus four call-site changes, and the `{@html}` surface is closed.

**C3. Personal Action Center first, single column** (decision 3). Section 2 is the actionable
half, so it leads at every viewport width, not only on mobile. No two-column body: the
reading measure from A3 is 68ch, which a side-by-side layout cannot honor on a laptop anyway.

- Order: Personal Action Center → Intelligence Briefing → Also noted.
- A sticky segmented control at the top switches between the two sections and doubles as a
  scroll indicator. It anchors to `--header-h` (M-6), not a hard-coded offset. On desktop the
  same control sits in the TOC rail (C6).
- Urgency becomes visual, not just a heading you scroll past: critical entries get a 3px left
  accent border in `--color-error-500` plus a "Critical" chip, high priority the warning hue,
  normal unadorned. Per A4, the chip text carries the meaning and the hue only reinforces it.
- If Section 2 is empty for the day, collapse it to a one-line "Nothing needs action today"
  and let the briefing take the top of the page. An empty panel above the fold is worse than
  no panel.

**C4. Inline rating.** Move the +/- from the detail page onto every report entry with a `refs`
anchor: hover on desktop, always visible and 44px on mobile (M-3). `feedback_events` currently
only fills up if the user takes a two-click detour, which means the relevance calibration loop
is starved. This is the single highest-leverage UX change in the plan, and it is exactly the
one that has to work under a thumb. Fixes X4 while touching the markup.

**C5. Inline expansion instead of navigation.** "Mehr dazu" currently navigates away and loses
scroll position. Make it expand the extraction cards in place (the detail page's content,
rendered inline) and keep `/[date]/detail/[ids]` as the deep-link fallback. The chip itself
gets a real tap target (M9).

**C6. Section anchors.** A domain jump list ("Also noted", per-domain) as a floating TOC on
desktop, a sheet from the segmented control on mobile. Report is 600-900 words plus 300-500,
so a phone read is several screens of scrolling with no orientation.

**C7. Live pipeline status.** Replace both "reload the page" messages with an SSE endpoint or a
5s poll against `pipeline_runs` and a phase progress display, reusing the `/context-builder`
progress-bar pattern. The report appears when it is ready. Fixes X5.

**C8. Archive and date picker.** `availableDates` is already loaded and unused on the client
(X3). Give it a real calendar popover with report days marked, a "last 7 / 30 days" list with
each day's `short_summary` as preview, and keyboard `j`/`k` for previous/next day. On mobile
this is also where the day steppers live after M-1 takes them out of the navbar.

**C9. Cost on the stats bar.** Derive from `tokens_in`/`tokens_out` with the shared `fmtCost`
(B2, and therefore with the right prices), show as a hover or tap detail on the token counts,
and add a 30-day cost sparkline to the runs page (D5). The stats bar itself becomes `StatBar`
and stops wrapping into orphaned separators (M10).

---

## 7. Phase D: functional gaps

Ordered by value per hour of work.

**D1. `/topics` (new): active topics.** The story continuity table, which is the reason the
system compounds, has no UI. List active topics with running summary, domain, first-seen,
last-updated, mention count; a timeline of the reports in which each appeared; an
archive/resolve action. Highest-value new page.

**D2. `/entities/[id]` (new): entity detail.** Name, aliases, type, domain, summary, importance,
status, `entity_relations` as an adjacency list (with confidence), `entity_appearances` as a
timeline, and links to the reports that mentioned it. Turns a flat table into an actual graph
explorer. A force-directed view is optional and lower value than the detail page. It is also
the natural target for a row tap on mobile, where the table columns are hidden anyway.

**D3. `/rules` (new): standing context.** CRUD over `standing_context` with the type
(`rule` | `preference`), the source (Keep-seeded vs. hand-written), and a preview of the block
as it is injected into the Section 2 prompt. The system is designed around the user curating
these and there is currently no way to do so outside the Context Builder document.

**D4. `/skills` approval controls.** Add Confirm and Reject for `pending` executions, a pending
count badge in the nav (from the registry, B3), and grouping by status. The registry editor
from `58162ff` did not close this: it changes what a skill *is*, not what a queued execution
does. Implements a workflow CLAUDE.md already specifies as manual. While here, give the
override layer a visible diff against the default rather than a 6px dot (P7, M13).

**D5. `/runs` (new): pipeline run history.** `pipeline_runs` as a table: date, status, duration,
failed step, per-phase timing, tokens, derived cost. A duration and cost trend chart.
Currently a successful run is invisible and a failed one only surfaces on its own date page.

**D6. `/prompts` diff view.** Render a line-level diff between the proposed version and the
currently active one for the same section, with the change summary above it. Collapse
identical context. Approving a prompt change blind is the current default and this is the
one page where the plan explicitly demands human judgement.

**D7. `/contacts` (new).** Contacts table with the context accumulated from the question gate,
inline editing, and the count of interactions. Lets the user pre-empt questions instead of
answering the same one twice. Keep it small on purpose: `contacts` is a sender directory, not a
social graph (CLAUDE.md), so a six-row table is the expected steady state.

**D8. Search, keyword first.** Full-text search across `daily_reports.full_report`,
`extractions`, `notes` and `entities` via Postgres `tsvector` with a GIN index and
`ts_headline` for snippets. A `⌘K`/`Ctrl+K` palette is the natural home, together with route
jumping. Store the `tsvector` as a generated column so it cannot drift from the text.

Note the collision: `⌘K` currently toggles the assistant (`Assistant.svelte:26`). Search takes
`⌘K` and the assistant moves to `⌘J`, or search lives behind `/`; decide when D8 ships, and put
both in the `?` overlay (E1).

This is the shipping version. Semantic search is a real want but is parked deliberately, with
its own reasoning, in §12: build D8 so that the parked version is an addition rather than a
rewrite: one `search()` function in `src/lib/server/search.ts` returning
`{ id, kind, title, snippet, score }[]`, with the ranking strategy behind that signature.
The UI must never know which backend produced the ranking.

**D9. Feedback view.** A small page or a `/sources` tab listing recent `feedback_events` with
the item rated, so the calibration loop is auditable. `/sources/[name]` already shows the
per-source totals; this is the item-level view behind them.

---

## 8. Phase E: UX polish

- **E1. Keyboard.** `j`/`k` day stepping, `/` search, `g` then a letter for route jumping,
  `?` for a shortcut overlay, and whatever `⌘K` ends up meaning (D8). Desktop only by nature,
  which is fine: the phone gets the bottom bar instead.
- **E2. Loading states.** Skeleton rows for tables, a spinner in buttons already covered by
  `Spinner.svelte`, and `navigating` from `$app/state` for a top progress bar.
- **E3. Toasts.** One toast store. `/notes` already has the only real toast in the app, with
  undo; promote it (B2) and route the four different inline `form?.error` / `form?.success`
  renderings through it, keeping inline errors only for field-level validation.
- **E5. Push depth.** The notification currently opens `/`. Include the report date and
  `short_summary` in the payload and deep-link to that date; add an action to jump straight
  to Section 2. Pairs with the offline cache from M-8: a push that opens an uncached page on a
  phone with no LAN is a dead end.
- **E6. Accessibility pass.** `aria-current` on nav, `scope="col"` on table headers, accessible
  names on all icon buttons (fixes X4), a skip link, and a text or shape indicator alongside
  every color-coded status (fixes P7 and M13). Contrast is already handled in A4; this step
  re-runs `contrast.ts` as a check rather than doing the remapping.
- **E7. Query parallelization.** `Promise.all` in `[date]/+page.server.ts`, and replace the
  60-row date fetch with two scalar queries for prev and next plus a separate archive endpoint
  for C8 (fixes S8 and X3).

E4 (PWA completion) has moved into Phase M as M-8, where it belongs.

---

## 9. Sequencing

| Step | Content | Effort | Risk |
|---|---|---|---|
| 1 | Phase A: tokens, contrast fixes (A4), fonts, scales incl. the 16px mobile floor, focus, finish runes | 1 day | low, no behavior change |
| 2 | Phase B: `<Page>`, component library, route registry, formatters, English pass | 1-2 days | low, large deletion of duplication |
| 3 | Phase M: M-1 to M-7 and M-9. Responsive nav, touch targets, inputs, tables, dvh/safe-area, device pass | 1.5-2 days | medium, touches every page |
| 4 | C1: Phase 5 JSON, `report_json` migration, parser, backfill | 0.5-1 day | medium, pipeline change |
| 5 | C2, C4: sanitize, inline rating | 1 day | medium, core render path |
| 6 | C3, C5, C6, C7, C8: section order, inline expansion, TOC, live status, archive | 1-2 days | medium |
| 7 | D1, D3, D4: topics, rules, skill approval | 1-2 days | low, additive |
| 8 | M-8, E5, E6: PWA completion, push deep-links, accessibility | 0.5-1 day | low |
| 9 | C9, D2, D5, D6, D8: cost display, entity detail, runs, prompt diff, keyword search | 2-3 days | low, additive |
| 10 | E1, E2, E3, E7, D7, D9: keyboard, loading, toasts, query parallelization, contacts, feedback | 1-2 days | low |

Steps 1 to 3 are prerequisites for everything else. Steps 1 and 2 should not be split across
sessions; step 3 may be, but M-9 runs at the end of it regardless, and no later step is
considered done until it has also been checked at 390×844 (decision 6).

Step 4 is the only step that touches the pipeline: ship it alone, verify against one real
report plus the backfill before starting step 5. Steps 5 and 6 are the only ones that can
visibly break the report, so they get their own commit sets and are verified against a real
report on a phone, not only in a desktop viewport.

Commit granularity per the project rule: one commit per phase item, not per phase.
Run `bun run check` in `dashboard/` before each commit.

## 10. Dependencies to add

- `isomorphic-dompurify` (C2), required.
- A diff library for D6, `diff` is sufficient.
- Inter + JetBrains Mono woff2 files under `static/fonts/` (A2), self-hosted, no runtime dep.
- PNG icons at 192/512 plus maskable (M-8), generated once from `static/icons/icon.svg` with
  `sharp` or `rsvg-convert` as a one-off, not as a project dependency.
- No charting library: the existing inline SVG approach plus `Sparkline.svelte` covers
  every chart in this plan.

## 11. Decisions

Settled 2026-09-10:

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
5. **Search: Postgres `tsvector` now, semantic search parked.** See D8 for what ships and §12
   for the parked idea and what it would cost to unpark it.

Settled 2026-09-12:

6. **The phone is the primary target, and it is a gate, not a phase item.** The stated use case
   is reading the briefing on a phone at 06:45, and the app has never been opened on one: 12 of
   17 components carry no responsive class at all. §2 is the audit, Phase M is the work, and
   from step 3 onward no phase item counts as done until it has been checked at 390×844.
   Desktop remains fully supported; it is simply no longer the only viewport that gets tested.
7. **On mobile the assistant is a bottom-bar tab, not a floating button.** Below `sm` the panel
   already takes the whole screen, so the launcher buys nothing and collides with the bottom
   bar, the notes toast and the iOS home indicator. Above `sm` the floating launcher stays
   exactly as it is, speech bubble included. See M-7.
8. **The app icon stays in the header and stays the home link** (shipped `ff57c91`). On mobile
   it is one of only three things left in the top bar (icon, page title, overflow), which is
   what makes a 52px header possible. The same SVG is the source for the PWA icon set (M-8),
   so the installed app, the tab and the header are visibly one thing.

---

## 12. Parked: semantic search over the archive

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

`CLAUDE.md` states, under non-negotiable architecture rules, that there are no vector stores
and that all retrieval is explicit keyword/entity lookup against Postgres, with this section
named as the design home for the far-future project. `CONTEXT_AND_DECISIONS.md` carries the
rationale. This plan does not silently override that. Unparking requires editing both documents
first, with a dated note recording what changed, in the same style as the 2026-09-10
credentials/diary narrowing. Until that happens, D8 is the only search that ships.

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
