# Offline mode

The installed app reads the briefing archive, notes, context document and reference tables without a network, and accepts notes and ratings while offline; they land in Postgres through the existing single writers when the connection is back.

The failure it is built for is not a fast error. A weak signal, a captive portal, or `pidra.de` resolving with pronix not answering behind it is a **blackhole**: the request neither succeeds nor fails, and a bare `fetch` waits for the OS connect timeout. DevTools' offline mode is fail-fast and cannot reproduce that, which is how a Questions tap once spun for minutes and ended in "500 Internal Error".

`pidra.de` is publicly reachable behind a login (`hooks.server.ts`) as the security boundary; it was VPN-only before 2026-09-28. The mirror was already designed for a network that cannot be trusted to answer, so that change needed nothing here. Keeping a copy of personal content on the device is the owner's decision of 2026-09-17.

## Mirror and outbox

**The mirror is a cache and the outbox is a queue, never a source of truth.**

- **Store:** IndexedDB (`$lib/offline/db.ts`), filled only from `GET /api/offline/snapshot`. It holds the newest `MIRROR_DAYS = 60` (`#lib/server/snapshotCache.ts`) report dates with their open and done quick actions (never an action's error text), the extractions they cite, every note including the trash (standing rules are `personal` notes, so they arrive here), active corrections, the newest harvest document, entities, contacts (removed ones left out), topics, and the entity appearances inside the window.
- **Schema version:** `DB_VERSION` is 4. The upgrade drops the `rules` store (standing rules became notes) and deletes any queued or failed `rule.*` intent, which no longer has an endpoint and would otherwise jam the drain.
- **Exclusions are enforced in the endpoint, not in a consumer:** no `raw_items.raw_content`, nothing from `chat_messages`, `skill_executions` or `push_subscriptions`, and `step_errors` only as the `ingestFailures` digest (source plus one fixed word).
- **Rendered on the server:** the snapshot ships sanitised HTML, so `renderMarkdown()` stays out of the client bundle.
- **Transfer:** a `304`, a delta against the client's ETag, or everything (`snapshotCache.ts`). A build the client has not seen replaces the mirror instead of merging into it.

## Tiers

**Every page is in exactly one tier**, declared in `dashboard/src/lib/routes.ts`:

- `MIRRORED_ROUTES`: client-rendered with `ssr = false`, reading through `$lib/offline/repo.ts`.
- `STATIC_OFFLINE_ROUTES`: prerendered and precached (`/privacy`, `/terms`).
- `ONLINE_ONLY`: offline, renders `OfflineNotice` with its one-line reason and comes back by itself when the server answers. For live state where a copy would be a lie: approvals, the question queue, prompt versions, runs, sources, triage, the chat.

`dashboard/scripts/check-offline.ts` fails the build on a page in no tier or two, and on a mirrored page that has a server load for its read, is not `ssr = false`, or awaits the network.

## Reads

**No load waits on the network.**

- A mirrored load answers from IndexedDB and starts a throttled, single-flight background `sync()`.
- When a sync changes a store, `invalidate("mirror:<store>")` re-runs exactly the loads that declared it (`deps.ts`). An empty mirror renders `FirstSync` in the page's place.
- Filters live in components over the loaded rows, never in a load, so typing re-renders instead of re-loading.
- The header logo (`SyncLogo`) is the sync control and opens the non-modal sync sheet (`SyncSheet`): status, last sync time, queued and failed cards, "Sync now", and "Clear offline data" behind an inline confirm. Logo colors: green synced, breathing green syncing, grey pulse checking, amber queued, red failed or offline. Pages do not repeat the sync age.

## Writes

**One writer each way.** A page reads through `repo` and writes through `outbox` (`note.*`, `rate`; `intents.ts`), never into the mirror directly.

- An intent is applied to the mirror optimistically and flushed in order to `/api/notes/*` and `/api/feedback`, which call the same helpers as the live paths (`src/notes/store.ts`, `rateExtraction()`).
- Replays are idempotent: a client-generated note id with `ON CONFLICT DO NOTHING`, a rating that replaces the previous one.
- A transport failure retries; a 4xx moves the intent to `failed`, shown on the row it belongs to (`FailedWrite`).
- A queued note edit whose row moved on the server still lands and is flagged, since `note_revisions` keeps both versions.
- **Never queued:** corrections and contact edits, topic curation, quick actions, pipeline and Context Builder runs, deep dives, revision reverts, skill approvals, the chat and listening to a briefing (the report page's Play button is disabled offline; audio is fetched on demand, never mirrored, and the player downloads each chapter through `net()` with its own 120 s budget). Once the app knows it is offline they are disabled with the reason; a tap before that is answered "Not sent" with what was typed kept.

## Network layer

**Client code never calls `fetch` directly.** `$lib/offline/net.ts` is the one caller (`check-offline.ts` fails on a bare `fetch(` in client code) and owns the budgets, in its `BUDGET` constant:

| Budget | Value |
|---|---|
| Probe (`/api/health`) | 3 s |
| Interactive tap | 15 s |
| Page data (`__data.json`) | 30 s |
| Sync | 60 s |

Budgets include reading the body.

- A request still waiting after 500 ms starts one shared probe. If the probe fails the app is offline and every request in flight is aborted at once; if it answers, the request keeps its budget. Known offline fails in the same frame.
- A response without the `x-pidra` stamp that `hooks.server.ts` puts on every response (nginx's 403, a captive portal) counts as not reaching pronix.
- `guardKitFetch()` in `hooks.client.ts` routes SvelteKit's own `__data.json` and form-action requests through `net.ts` and bounds its `version.json` check.
- `navigator.onLine` is only ever used as a certain negative. Polling goes through `poll.ts`, which never overlaps and pauses while hidden or offline.

## Service worker

`dashboard/src/service-worker.ts`:

- Precaches every build file per version and keeps the previous build's cache one generation longer (`GENERATIONS_KEPT`). A new version waits, and the navbar offers "Reload" rather than taking over mid-read.
- Mirrored paths get the shell (the route-agnostic HTML of any mirrored route, marked `x-pidra-shell`) cache-first, online or not. Other navigations race the network against 3 s (`NAV_BUDGET_MS`), then boot the shell, whose load fails into `OfflineNotice`.
- Every request the worker makes is aborted at its budget. It never touches `/api/**` or `__data.json`.
- It syncs as well: on the push (so the 06:30 briefing is in the mirror before it is opened), on Background Sync (`pidra-outbox`) when a write is still queued, and on periodic sync (`pidra-mirror`) where the browser grants one. It runs the pages' own `intents.ts` and `snapshot.ts` under two Web Locks, so a page and the worker never send one intent twice. iOS has neither Background Sync nor periodic sync: there the push and the app's own start do the syncing.
- `/service-worker.js` must be served `Cache-Control: no-cache` (nginx; see `docs/operations.md`).

## The proof: `dashboard/scripts/blackhole/`

`bun run test:offline` in `dashboard/`, also the last (slowest) step of `bun run check` (about 65-70 s; skipped by `--quick`). Needs Chrome on `PATH` or in `PIDRA_CHROME`. It builds, runs the production server with no database behind it, and drives Chrome at 390x844 through a proxy (`proxy.ts`) per failure mode: blackhole, gated (nginx's 403), refused, and DevTools offline. A synthetic snapshot (`fixture.ts`) means nothing in the suite touches real data. `--only <mode|layout>` runs one lane.

**Offline lanes**, for every page in `routes.ts`:
- a designed state within 4 s after a tap made while the app still believes it is online, after a cold start, and after each primary control;
- no request outlives its budget;
- the queue survives a reopen;
- each queued write lands exactly once and in order after reconnecting.

A new page needs its path and expected text in `run.ts`; a new control needs an entry in `CONTROLS`.

**Layout lane** (`layout.ts`), online at 1024, 1280, 1366 and 1920 px against `LAYOUT_SNAPSHOT` (several rows per table, a report with every urgency, section and domain, a five-section context document). For every mirrored page it asserts from the DOM:
- no error boundary and no horizontal scroll from the page or `<main>`;
- header on one row with an untruncated title;
- `<main>` exactly as wide as its `--container-<size>` cap, and centred;
- content spanning at least 90% of the frame;
- on `/[date]`, the article beside the rail from `xl` up.

**What it cannot cover:**
- An iOS PWA's lifecycle or a real VPN: the phone stays the final check.
- Page logic that needs a large fixture: `ONLINE_ONLY` pages render `OfflineNotice` with no database behind them, and the offline lanes use a small snapshot, so something like `/topics`' lazy-reveal cap is out of reach. `dashboard/tests/` (`bun test --conditions=browser`, jsdom via happy-dom, part of `check` and `check:quick`) covers it by rendering a `+page.svelte` directly against a large fixture.
- Single branches of the offline core: the same `dashboard/tests/` directory holds unit tests (`offline-*.test.ts`) for `db.ts` (reconcile, `update`/`move`, `withLock`, the v3 to v4 upgrade), `intents.ts` (optimistic apply, `drain` ordering, 4xx to failed, 5xx retried, conflicts, supersede while in flight), `outbox.ts`, and `snapshot.ts`/`sync.ts` (ETag, 304, delta, throttle, single-flight, flush before pull). They run on `fake-indexeddb` with `$app/env` (`browser` false, so `net()` goes straight to `fetch`) and `$app/navigation` stubbed in `tests/setup.ts`, and complement the blackhole lanes, which prove the same code end to end.
