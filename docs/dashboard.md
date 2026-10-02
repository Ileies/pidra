# Dashboard

SvelteKit app in `dashboard/`. Offline behavior (mirror, outbox, service worker) is in `docs/offline-mode.md`.

## Route registry

**Every page is declared once, in `dashboard/src/lib/routes.ts`.** The entry carries the nav label, assistant surface, group, icon, child route ids, `g`-key shortcut and the flags below. The navbar, the mobile tab bar and the assistant's client-side surface fallback all render from it, and `scripts/check-route-surfaces.ts` (part of the root `bun run check`) fails the build when an entry's surface disagrees with `src/ai/surfaces.ts`. Adding a page means adding one entry there and, if it needs more than the `global` surface, one line in `ROUTE_SURFACES`.

Entry flags: `tab` (one of the mobile tab destinations: Report, Notes, Chat), `secondary` (folded into the desktop More menu), `headerIcon` (Settings), `hidden` (registered for its offline tier and surface but never rendered as a nav link; only reachable from a link inside another page, e.g. `/privacy`, `/terms`, `/setup` and the `/settings/*` subpages). The same file holds the offline tier lists (`MIRRORED_ROUTES`, `STATIC_OFFLINE_ROUTES`, `ONLINE_ONLY`).

## Routes

Report:

- `/[date]` - the daily report. Section 2 leads at every width, then the News section (`NewsSection`: the desks' stories under the editor's headings, source links inline), then Section 1. Entries carry inline +/- rating, and tapping the entry itself expands its sources in place (Enter/Space when it has focus; clicks on a link or button inside it and text selections don't count). There is deliberately no button for it: the cue is a chevron after the entry's last word (`.entry-prose` in `app.css`, absent when an entry ends in a list or code block), a hover/press tint, and a one-time plain-text hint above the report (`EntryHint`, dismissed once any entry is opened, per-device `localStorage` flag in `entry-hint.svelte.ts`). A personal entry carries its quick actions (`QuickActions`), and any the report never mentions sit in their own block at the end of Section 2. Also a stats bar, day steppers, archive picker and live run status. `IngestWarning` sits above the briefing whenever a source failed to deliver on that run, because Phase 1 carries on when one dies and the report otherwise reads as complete. Below `xl` the section tabs are a floating glass pill that sticks under the header; at `xl` they move into the sticky right rail beside the article, which holds run stats, open actions, the section tabs and the "Jump to a story" list, and scrolls inside the viewport on short screens.
- `/[date]/detail/[ids]` - the extractions behind one entry: the shareable deep link and the no-JS fallback for the inline expansion. Each non-news card has an online-only "Fetch contents" button that reads the stored mail body from `GET /api/extractions/[id]/raw` (`no-store`); the body lives only in component state and is dropped on "Hide contents" or navigation, never written to the mirror.
- `/[date]/triage` - everything that arrived on that run and where it stopped: dropped at ingest, never extracted, dropped at the gate, seen by synthesis and passed over, or cited. Filter chips per outcome plus search; linked from the report's "filtered" figure.

Intelligence:

- `/sources` - source quality list (trust scores, include rates, last delivery). Each row links to "Details"; "Enable" appears only for disabled sources. Enable writes straight to Postgres (`dashboard/src/lib/server/sources.ts`), so it works without the pipeline server; failures come back as a toast.
- `/sources/[name]` - every delivery from one source and what extraction made of it. The only place a source can be hard-deleted: its scores and polling/matching settings are erased, past reports and their data are not. Optional "also open unsubscribe link" when one was found at ingest.
- `/feedback` - the item-level rating log behind the per-source totals.
- `/entities` - entity explorer (filterable table); search matches name, aliases and summary.
- `/entities/[id]` - one entity: a Watch control (sets `importance = 'high'` through the correction path, feeding the monitoring search slot) and its appearances as a timeline.
- `/topics` - `active_topics` with resolve and archive. Curation only: no skill may write this table.
- `/contacts` - the sender directory. Edits go through `recordCorrection`, so they behave exactly as the assistant's do.

Memory:

- `/notes` - cards dealt round-robin into 1/2/3 columns (`Masonry`, by container width: under 600 px, under 1300 px, wider), so newest-first reads left to right and a growing card moves only the cards under it. A resting card is the note (clamped at 10 lines, Show more) plus one footer line: scope badge, expiry when set (warning within 7 days, error when past), relative date (`fmtAgo`), the author only for non-user notes, "N changes", Restore in the trash. All creating and editing goes through one `NoteEditor` (card click or New note): scope chips with a hint of what the scope steers, expiry date with +1 week / +1 month / No expiry, one PATCH so one edit is one revision, explicit Save/Cancel with no blur-save, an "Unsaved" marker, Delete and the history link inside it; Ctrl+Enter saves, Esc discards. Drafts live in the page, so they survive the columns being re-dealt. The toolbar (`NotesToolbar`) has search, New note, scope chips with live counts, a sort popover, Select and a Notes|Trash switch; selection mode shows a bottom bulk bar (Set scope / Delete, or Restore in the trash). History opens in a modal `Sheet` (bottom sheet on phones) showing each revision as a word diff against the current text with "Restore this version"; it stays online-only. Scope colours and hints are `SCOPE_INFO` in `lib/notes/api.ts` (`contact` is "Reference only": no briefing reads it yet). Only the first 200 notes are shown, with a line saying so. System notes are editable too; provenance stays visible via `created_by` / `updated_by` (`harvest` reads "Keep import"). The standing rules from Keep are ordinary `personal` notes edited here; there is no separate rules page. A trashed rule seeded from Keep (`source_key` set, carried in the offline snapshot and `NoteRow`) says it is kept so Keep does not re-add it, instead of "purged after 30 days".
- `/context-builder` - the harvested document and source summaries, and run controls. The status bar holds only the run controls (Start, Force full, Stop). At `xl`+ a Quick Links rail sits beside the document and always renders, even with no document: document headings and source summaries (scrollspy highlighting), then plain underlined links to `/notes?scope=personal` ("Standing rules") and `/context-builder/corrections` ("Corrections"), with no counts and no standing-rule list. Below `xl` there are no quick links, so this page has no direct link to `/notes` or `/context-builder/corrections` there.
- `/context-builder/corrections` - the active `context_corrections` over the harvest; a revert is written on the server, never queued.

Questions and assistant:

- `/questions` - the open question queue. Each question is answered or dismissed on its own; recently closed ones show the reason and a reopen. Item questions sort first, then newest asked; assistant-raised ones are badged "Asked by the assistant". Briefings never wait for answers, and answering makes the assistant act right away (the `questions` surface).
- `/questions/closed` - recently closed questions. An answered one shows what the assistant did (`running`, applied or failed), its own account of the change, a "See every step" link to the chat transcript (`/chat?c=<id>`), and "Run again" unless it already succeeded.
- `/chat` - the assistant full screen: the same `Panel` the floating widget uses, plus the conversation list and the active corrections. Shares one live conversation with the widget. `?c=<id>` opens that conversation; no param (or `?c=new`) is an empty composer, so a reload or direct visit always starts a new chat. The open conversation id lives only in the in-memory assistant state (no sessionStorage key), so a client-side navigation to bare `/chat` redirects onto the live conversation via `?c=<id>` with `replaceState` (keeps Back from looping).

System:

- `/skills` - the pending high-risk approval queue and the read-only registry with an enable/disable toggle. The registry header shows the total skill count ("N skills", plus "(M shown)" while searching) with a search box and a sort dropdown: alphabetical (default), most used, or risk level (critical first). Each row shows its 30-day usage, the count of non-pending `skill_executions` rows from the last 30 days (`uses` on `SkillInfo`, loaded in `+page.server.ts`). `/skills/executions` is the last 100 non-pending executions.
- `/prompts` - prompt versions: diff against whatever is running for that section, activate, delete. The `section2` card also has a collapsible preview of the `notes_personal` block as the payload carries it (live `personal` and `global` notes, which is where the standing rules now sit).
- `/runs` - `pipeline_runs` history with duration and cost trends and the per-attempt error log. Each row is a two-line block whose "N sources failed" / failed-step text toggles its error card, with a Breakdown link pinned right. A failed or degraded run not yet reviewed carries "Mark reviewed" (the `reviewRun` form action) and is what the Runs badge counts; RSS feed failures count as run issues here.
- `/runs/[id]` - one run's step timing from `pipeline_run_steps`: a Gantt-style graph, a callout when the old question-gate wait dominates (present only on historic runs, and can be shrunk), and cost per phase and step from `$lib/pricing.ts`. Online-only; empty for runs before 2026-10-01.
- `/settings` - see below.
- `/settings/email-accounts` - live IMAP/SMTP accounts, one row each with folder, aliases, ignore, SMTP and custom-instructions detail behind a disclosure.
- `/settings/newsletters` - live RSS feeds; a feed's latest fetch error sits below its URL, and removing the row stops polling it.
- `/settings/newsletters/rules` - live sender rules routing a sender to a newsletter source before extraction; exact addresses win over domains.
- `/login`, `/setup` (passkey and PIN management), `/privacy`, `/terms` - public pages outside the nav (`/privacy` and `/terms` are prerendered).

### `/settings`

Mirrored offline like the rest of the page, except the language fields, which need the connection (the theme select is device-local and works offline). The page has no server load.

- **App card** (`InstallApp`): an Install button whenever PIDRA is not installed. It is enabled once the browser has offered its install prompt; otherwise disabled with manual steps (iOS Share > "Add to Home Screen", or the browser menu). It also has an installed state, and "Open the app" only on desktop Chromium, the one place a tab navigation is captured into the installed app. There is no uninstall control because no browser exposes one, and the UI never says "PWA".
- **Install-prompt plumbing**: Chrome fires `beforeinstallprompt` once, ~100 ms after load and before hydration, so a small inline script in `app.html` stashes it on `window.__pidraInstallPrompt` and `pwa.start()` in the root layout (`$lib/pwa.svelte.ts`) picks it up. The script's sha256 is `INLINE_INSTALL_PROMPT_HASH` in `hooks.server.ts` (report-only CSP): change the script and the hash goes with it. `app.html` has a second hashed inline script that applies the stored theme before first paint (`INLINE_THEME_HASH`, same rule).
- **Installed-app detection** (`getInstalledRelatedApps`, which needs `related_applications` in the manifest) runs only from the card, never while offline, and is abandoned after 3 s: it makes the browser re-fetch the manifest with no way to cancel, so the blackhole suite treats `/manifest.webmanifest` as a browser-owned request.
- **Preferences**: a Theme select (Dark default, Light, System) stored per device in `localStorage` key `pidra:theme` and managed by `$lib/theme.svelte.ts` (`loadTheme` from the root layout, `setTheme` from here). It works offline and touches no API or DB. The content-language select (what briefing, questions and chat are written in; applies from the next briefing) saves on change with a toast, and is disabled until the stored values load and while offline. The interface-language select is permanently disabled ("Translations coming soon") until Paraglide lands (`docs/todo/later.md`). Both go through `GET`/`PATCH /api/settings`, validated against `src/config/languages.ts`.
- Then links to account and source configuration.

## Navigation

Rendered from the registry; registry order is the order everywhere.

- **Desktop (`lg`, 1024 px, and up):** the row shows only the non-`secondary` entries (Report, Notes), icon-only. Everything else sits in the More menu, a 3x3-dots button opening a three-per-row grid of icon tiles in registry order: Questions, Chat, Sources / Contacts, Entities, Topics / Context, Feedback, Skills / Prompts, Runs (11 items). Settings is an icon-only header button at every width, last. No dividers, transparent header (a fill appears once the page scrolls).
- **Mobile:** a bottom tab bar (`tab` entries: Report, Notes, Chat) plus a More sheet. `secondary` only affects the desktop navbar.
- **Badges:** `GET /api/nav-badges` returns counts keyed by href (`/` unread reports, `/questions` open questions, `/runs` unreviewed failed or degraded runs, `/skills` pending approvals), shown as a red `CountBadge` on each page's button and summed on More (`Navbar` sums the tiles inside it, `TabBar` the rows of its sheet). There is no notifications page or bell. Unread reports are acknowledged by reaching the end of the report (`POST /api/notifications/report-read/[date]`); run issues with "Mark reviewed" on `/runs`.
- **Header:** the logo (`SyncLogo`) is the sync control; the "PIDRA" wordmark next to it links home, hidden between `lg` and `xl`, where the Report button is the way home. The "A new version of PIDRA is ready" notice lives in the navbar: centered from `md`, a refresh icon with a dot on phones.

## Floating assistant

Mounted once in `+layout.svelte`, so it is reachable from every page and a turn survives navigation. Each page declares what it shows with `setPageContext()` (`$lib/assistant/state.svelte`); the `focus` list hands the model real ids for the rows on screen. Turns stream over SSE (`POST /api/assistant/chat`), tool calls appear as they run, and a turn that wrote something triggers `invalidateAll()` plus a highlight on the changed rows. Hidden on `/chat` (the same thing full screen) and below `sm`, where the bottom bar's Chat tab replaces it.

## Conventions

- **Layout:** pages are wrapped in `<Page size="read|app|form|legal">`, which owns container width (`--container-*` in `app.css`) and responsive padding. `legal` is wider than `read`, for prose pages.
- **No visible `<h1>`** on the list and management pages (`/sources`, `/contacts`, `/settings`, `/feedback`, `/topics`, `/runs`, `/skills`): the tab title (`Page`'s `title` prop) and the nav say where you are. The blackhole layout check wants content spanning at least 90% of the frame, so a page whose body is a capped column (like `/settings`) wraps it in a full-width div instead of relying on a full-width heading.
- **Formatting helpers:** dates and numbers through `$lib/format.ts`, DB enum values through `$lib/labels.ts`, cost through `$lib/pricing.ts`.
- **Markdown:** every `{@html}` goes through `renderMarkdown()` in `$lib/markdown.ts`; nothing else may call `marked`.
- **Icons** come from lucide (`@lucide/svelte`, imported per icon from `@lucide/svelte/icons/<name>`); emoji are never icons. `dashboard/static/icons/icon.svg` is the single source for the header logo, favicon and PWA icons: editing it means regenerating the PNGs beside it.
- **Language and palette:** the interface is English throughout, including the assistant's surface hints, until Paraglide is installed and `user_settings.ui_language` takes effect. The palette is dark by default, with light and system (OS-driven) selectable per device in Settings: every ramp stop in `app.css` is a `light-dark(light, dark)` pair and `color-scheme` on `:root` follows `html[data-mode]`. `dashboard/scripts/contrast.ts` enforces the contrast floor in both modes on every check; its DARK and LIGHT palettes must stay in step with `app.css`.
- **Phone first:** a change is checked at 390x844 on a real device before it counts as done. A desktop viewport resized narrow is not that check. The blackhole layout lane covers 1024, 1280, 1366 and 1920 px; the desktop shell (navbar row, no tab bar, floating assistant) starts at `lg`.
- **Offline:** every page belongs to exactly one offline tier and no client code calls `fetch` directly; both rules are in `docs/offline-mode.md`.
