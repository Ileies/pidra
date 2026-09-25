# OFFLINE_PLAN.md - PIDRA offline mode

> **Goal:** the phone app reads the briefing archive, the long-term context, the rules and the notes with the VPN switched off, and accepts notes, edits and ratings while it is off. Everything written offline lands in Postgres, through the existing single writers and with the existing provenance, when the VPN comes back. Nothing about the pipeline, the report contract or the write-path rules changes: the offline copy is a **cache and a queue**, never a second source of truth.

---

## 0. The failure this fixes

The dashboard is at `https://pidra.ileies.de`, nginx-restricted to `10.200.200.0/24`, proxying to `127.0.0.1:3009` on pronix. With wg0 down, the origin is not slow, it is **absent**: the name may not even resolve, and if it does, nginx answers 403 from the public path. Every page is server-rendered from Postgres, so today "VPN off" means "no app".

Two consequences run through the whole design:

1. **`navigator.onLine` is the wrong signal and must never be the deciding one.** It reports the WiFi link, and the exact failure here is WiFi up, wg0 down. It is usable as a cheap *negative* ("definitely offline"), never as a positive.
2. **Offline is the normal case, not the error case.** The briefing is read on a train at 07:00. The app has to be designed so that the offline path is the same code path as the online one with a different data source, rather than an error branch that only runs when something breaks.

---

## 1. Scope

**Tier A - works fully offline, reads from the local mirror:**

| Route | Offline reads | Offline writes |
|---|---|---|
| `/[date]` | report, stats, ratings state | ratings (+/-) |
| `/[date]/detail/[ids]` | extraction cards (no raw bodies) | ratings |
| `/notes` | list, search, filters, trash, revisions | create, edit, scope, expiry, delete, restore |
| `/rules` | `standing_context` rows | create, edit, delete |
| `/context-builder` | the harvest document, standing rules, active corrections | none |
| `/entities`, `/entities/[id]`, `/contacts`, `/topics` | read-only tables | none |

**Tier B - online only, and honest about it:** `/sources`, `/sources/[name]`, `/feedback`, `/skills`, `/prompts`, `/runs`, `/questions`, `/chat`, `/[date]/triage`. These get an `OfflineNotice` in place of the page body instead of a browser error page. They are live operational state (a pending approval queue, a running pipeline, an SSE chat with a model) where a cached copy would be a lie, which is the same rule the current service worker comment already states.

**Deliberately not written offline, with reasons:**

- **Context corrections** (`/contacts` edits, `revise_context`, correction reverts). A correction merges named fields into an `entities` or `contacts` row, snapshots `previous_state` and **locks the row against re-seeding**. Replaying that blind three days later, against a row that may have moved, is the one write in this system where a stale base state does lasting damage. Corrections stay online-only until the rest of this works.
- **Anything that writes a report.** Reports are final; the rule does not bend because the writer was offline.
- **Skill execution, pipeline triggers, the chat.** All need the model, the bridge, or both.

---

## 2. Why the current PWA cannot do this

`dashboard/static/sw.js` is a good push worker with the beginnings of a cache. Three concrete gaps:

1. **The precache list is hand-written and contains no build assets.** `SHELL_ASSETS` names the manifest, the icons and two fonts. Everything under `/_app/immutable/` is cached opportunistically, cache-first, only after it has been fetched once. So after any deploy, a cold offline start has no JS at all and shows nothing. A build-time asset list is the only correct answer, and SvelteKit hands one out.
2. **Every page is `+page.server.ts`.** Offline, a full navigation has no HTML and a client-side navigation has no `/<path>/__data.json`. Only `/YYYY-MM-DD` navigations are cached, and only as opaque HTML, so a cached report cannot be rated, searched or re-rendered.
3. **There is no write path at all.** A form action posted with no network fails, and the optimistic rating in `RateButtons.svelte` is reverted by the next load.

---

## 3. Architecture

```
  ┌──────────────── browser ────────────────┐        ┌────── pronix (wg0) ──────┐
  │                                          │        │                          │
  │  page (+page.ts, ssr = false)            │        │  /api/offline/snapshot   │
  │        │ reads                           │        │        reads             │
  │        ▼                                 │        │          │               │
  │  repo.ts ──► mirror (IndexedDB) ◄──sync──┼────────┼──────────┘               │
  │        │                  ▲              │        │                          │
  │        │ writes           │ applies      │        │  /api/notes/*  ──► bridge│
  │        ▼                  │              │        │  /api/feedback ──► db    │
  │  outbox.ts ──────flush────┼──────────────┼───────►│  /api/rules/*  ──► db    │
  │                                          │        │                          │
  │  service-worker.ts: assets, shell, push  │        └──────────────────────────┘
  └──────────────────────────────────────────┘
```

**Decision 1: Tier A pages become client-rendered and local-first (`ssr = false`), reading through one repository module.**

This is the load-bearing decision, so the reasoning matters. With `ssr = false`, SvelteKit's server emits a route-agnostic shell: `render.js` gates the hydrate payload on `page_config.ssr`, and `client.js` `_start()` falls back to a client-side `navigate({ type: "enter", url: location.href })` when no payload is present, re-deriving the route from `location`. That is the same mechanism `adapter-static`'s SPA fallback uses, and it means **one cached HTML document can boot the app at any Tier A path**. Verified in `node_modules/@sveltejs/kit/src/runtime/server/page/render.js:353` and `.../client/client.js:_start`.

What this buys beyond offline: the shell paints from cache immediately and the report appears from the mirror in the same frame, with a background refresh behind it. Over a VPN link that is faster than today's SSR round trip, not slower.

**Decision 2: the snapshot carries *rendered, sanitised HTML*, not markdown.** `renderMarkdown()` stays server-only, exactly as it is now (its only callers are three `+page.server.ts` files and `search.ts`). The mirror is a render cache. This keeps the CLAUDE.md rule "every `{@html}` goes through `renderMarkdown()`" literally true, keeps sanitisation on the server where the allowlist lives, and keeps `marked` plus `isomorphic-dompurify` out of the client bundle.

**Decision 3: the mirror is never written to directly by a page.** A page calls `repo`, which reads the mirror; a page mutates through `outbox`, which appends an intent, applies it optimistically to the mirror, and tries to flush. One writer for the mirror, mirroring how `src/notes/store.ts` is the one writer for `notes`. The same rule, one layer out.

**New modules** (all under `dashboard/src/lib/offline/`):

| File | Responsibility |
|---|---|
| `db.ts` | ~120 line IndexedDB wrapper: `open()`, `get`, `getAll`, `put`, `bulkPut`, `del`, `tx`. No dependency; the surface needed here is small and a wrapper library is more code to audit than to write. |
| `sync.ts` | Pull a snapshot or delta, write it to the mirror, prune the window, record `lastSyncedAt`. Idempotent and safe to call from anywhere. |
| `repo.ts` | The read API the pages use: `report(date)`, `archive()`, `extractions(ids)`, `notes(filters)`, `rules()`, `context()`, `entities()`, `contacts()`, `topics()`. Each returns `{ data, source: "network" \| "mirror", syncedAt }` so the UI can always say where the bytes came from. |
| `outbox.ts` | Append, apply optimistically, flush, retry, reconcile, surface failures. |
| `state.svelte.ts` | Runes store: `reachable`, `lastSyncedAt`, `pending`, `failed`. What the header indicator and the sync sheet render from. |

---

## 4. What the mirror holds

Measured against the live database on 2026-09-17:

| Dataset | Rows now | Bytes now | Growth | In the mirror |
|---|---|---|---|---|
| `daily_reports` | 10 | 114 kB (`full_report` + `report_json`, avg 11.7 kB/day) | ~12 kB/day | newest 60 days, rendered HTML |
| `extractions.extracted_json` | 326 | 215 kB (avg 675 B) | ~25 kB/day | only those referenced by a cached report |
| `raw_items.raw_content` | 361 | 186 kB | ~20 kB/day | **never** |
| `notes` | 4 | 1.4 kB | negligible | all, including trash |
| `note_revisions` | 0 | - | negligible | all |
| `standing_context` | 18 | 4.8 kB | negligible | all |
| `context_corrections` | 3 (2 active) | <1 kB | negligible | active only |
| harvest document | 1 file | ~6.5 kB | monthly | newest only |
| `entities` / `entity_relations` | 238 / 38 | ~170 kB table | slow | all, list fields only |
| `contacts` | 9 | <10 kB | slow | all |
| `active_topics` | 57 | <70 kB | slow | all |

A 60-day window comes to roughly **2 to 3 MB** including rendered HTML, growing about 40 kB per day. That is far inside any storage quota, which is why the window is generous and the pruning rule is trivial: keep the newest `MIRROR_DAYS = 60` report dates and the extractions they reference, drop the rest on every successful sync.

**Never in the mirror, enforced at the snapshot endpoint rather than in a consumer** (the same choke-point rule the Keep credential filter follows):

- `raw_items.raw_content`. The inline expansion already loads extractions with `withRawContent: false`; offline gets the same treatment, so raw newsletter and personal mail bodies never leave the server. The detail page's raw-body pane is an online-only affordance, and says so.
- Anything from `chat_messages`, `skill_executions`, `push_subscriptions` or `pipeline_runs.step_errors`.

**One digest is derived from `step_errors`, and it is not a hole in that rule.** Each report carries `ingestFailures`: the Phase 1 sources that never delivered on the run behind it, as a source name plus one of four fixed words (`timeout | auth | connection | unknown`). It exists because Phase 1 deliberately does not abort when a single source dies, so a run with a dead mailbox still writes a report and still records `completed` - and the reader then has no way to tell mail that never arrived from mail that was never sent. `ingestFailures()` in `$lib/pipeline.ts` classifies, `withoutDetail()` drops the message, and the snapshot endpoint calls both, so no error text crosses and the classification cannot drift between the briefing's warning and the one on `/[date]/triage`. Only `phase1` attempts are read: a later step failed after the mail was already in hand, and those are the messages that quote content - the 2026-09-11 run recorded a failing `INSERT INTO contacts` with its values inline.

---

## 5. The snapshot endpoint

One endpoint, not ten: `GET /api/offline/snapshot?since=<iso8601>`.

- Without `since`: the full window. With `since`: only rows whose `updated_at`/`created_at`/`report_date` moved after that instant, plus a `deleted` list of ids per store so a deletion on another device propagates.
- Answers `{ version, generatedAt, since, stores: { reports, extractions, notes, noteRevisions, rules, corrections, contextDoc, entities, contacts, topics }, deleted, prune: { reportsBefore } }`.
- `version` is the app build version. A client whose stored version differs discards the mirror and pulls fresh rather than merging across a schema change. Cheap, and it removes a whole class of migration code.
- Reuses the existing server helpers rather than re-querying: `loadExtractions()`, `readContextDocument()`, `renderMarkdown()`, the `search.ts` neighbours. The endpoint is assembly, not new SQL semantics.
- `Cache-Control: no-store`. The service worker must never cache it; `sync.ts` decides what is kept.

A full pull today is a few hundred kB; a daily delta is tens of kB. No pagination in v1, with a comment naming the threshold at which it would be needed.

---

## 6. The outbox

An intent is `{ id, kind, payload, baseVersion, createdAt, attempts, lastError }`, stored in IndexedDB and appended in order.

| Kind | Endpoint | Idempotency | Conflict rule |
|---|---|---|---|
| `note.create` | `POST /api/notes` | client-generated UUID sent as the row id | none possible |
| `note.update` | `PATCH /api/notes/:id` | id + `baseUpdatedAt` | applies and flags (see below) |
| `note.delete` / `note.restore` | `DELETE` / `POST /api/notes/:id/restore` | soft delete is already idempotent | last one wins |
| `rate` | `POST /api/feedback` (new) | one rating per extraction, delete-then-insert | last one wins, collapse queued duplicates per extraction id |
| `rule.create` / `rule.update` / `rule.delete` | `POST`/`PATCH`/`DELETE /api/rules[/:id]` (new) | key is unique; create is upsert-on-key | last one wins |

**Two small server changes, both justified beyond offline:**

1. `createNote()` in `src/notes/store.ts` takes an optional `id` (UUID-validated), inserted with `ON CONFLICT (id) DO NOTHING`. This is what makes a replay whose response was lost safe, and it costs one parameter. `src/notes/store.ts` stays the single writer; the dashboard still only proxies.
2. `POST /api/feedback` in the dashboard, calling the existing `rateExtraction()`. The form action at `?/rate` stays for the no-JS path and calls the same helper, so there is still one implementation. A form action is a poor replay target: it needs SvelteKit's action protocol and returns a page payload, neither of which belongs in a queue.

The `/api/rules` endpoints are new JSON twins of the existing `/rules` form actions, both calling one shared helper so the two cannot drift.

**Flush triggers, in order of how much they can be relied on:**

1. On app start and on `visibilitychange` to visible. This is the primary path and the only one guaranteed on every platform.
2. On the `online` event, followed by a reachability probe (see §8), because `online` fires for WiFi, not for wg0.
3. Service worker `sync` event, tag `pidra-outbox`, where Background Sync exists. Treat as a bonus: it is absent on iOS Safari. Confirm on the actual phone before relying on it for anything.
4. On the `push` event. The 06:30 briefing notification is already delivered to this device; the worker can pull the delta at the same time, so the morning report is in the mirror before it is opened. This is the piece that makes "read the briefing on a train with no VPN" work without the user having opened the app while connected first.

**Conflict handling, single-user honest version.** A queued note edit carries the `updatedAt` it was based on. If the row moved since, the edit still applies, and the note is flagged in the UI as "changed on the server while you were offline". Nothing is lost either way, because every mutation appends the pre-change state to `note_revisions` and the history panel on `/notes` already reverts per revision. Building a merge UI for a one-person system would be more machinery than the revision trail already provides. A replay whose target no longer exists (404/410) does not silently disappear: the intent moves to a **failed** list with its payload intact, so the text can be recovered or re-filed.

**Ordering:** intents flush strictly in order and stop at the first hard failure, so a queued create followed by its edit cannot invert. Transport failures retry with backoff; 4xx other than 409 is terminal and moves the intent to failed.

---

## 7. The service worker

Replace `dashboard/static/sw.js` with `dashboard/src/service-worker.ts`, built by SvelteKit so that `$app/service-worker` supplies `build`, `files`, `prerendered` and `version`.

- **Precache** `build` and `files` on install, keyed by `version`, and delete every cache from another version on activate. This is the gap that makes a post-deploy cold start fail today.
- **The shell.** All Tier A routes are `ssr = false`, so the HTML the server returns for them is route-agnostic (§3). The worker stores the HTML of any successful Tier A navigation as `shell.html`, stamped with `version`, and serves it for any navigation it cannot reach the network for. A stamp mismatch discards it rather than booting a shell that references deleted chunks. If runtime capture proves flaky in the spike, the alternative is a prerendered `ssr = false` route serving the same purpose, which costs a `building` guard in `+layout.server.ts` so the badge queries do not run at build time.
- **`/` offline** resolves to the newest cached report date, not to today's. With the VPN off overnight, today's briefing was never fetched; landing on an empty "no report yet" page when yesterday's is in the mirror is the wrong answer. The date shown is always explicit and always accompanied by "synced <relative time>".
- **`/api/**` is never cached by the worker.** The repository layer decides what stale data is acceptable, in one place, in code that can reason about it. A worker that quietly answers an API call from a cache is exactly how a stale rating or a vanished note appears as a bug with no explanation.
- **Push and `notificationclick` move over unchanged**, plus the delta pull described in §6.

**Migration off `/sw.js`, which is the part that can go wrong silently.** The new worker registers at `/service-worker.js`; a registration at a different scriptURL does not replace the old one. So: register the new worker, enumerate `navigator.serviceWorker.getRegistrations()` and unregister anything whose `active.scriptURL` ends in `/sw.js`, delete every `pidra-*-v1` cache, then delete `static/sw.js` from the repo so it 404s. Do all of it in one release. A device left on the old worker keeps serving old assets from cache and would lose push when the file disappears.

**nginx** must send `Cache-Control: no-cache` for `/service-worker.js`, or a proxy-cached worker pins the app to an old build. That lives in `hosts/pronix/nginx.nix` in the nixos flake, so it needs a `nixos-rebuild` **on pronix** and is not carried by `bun run deploy`.

---

## 8. Reachability, not `navigator.onLine`

`GET /api/health` (new, ~5 lines, no DB access: liveness of the dashboard process, which is what wg0 gates) is probed with a 3 second timeout:

- on start, on `online`, on `visibilitychange`, before every flush, and on a 60 second interval while the app is visible and believed offline (backing off to 5 minutes after repeated failures, and not polling at all while hidden);
- `navigator.onLine === false` short-circuits to offline without a probe;
- two consecutive failures flip to offline, one success flips to online, so a single slow response does not flap the indicator.

---

## 9. What the user sees

- **Header indicator**: a dot next to the title. Online, offline, or "N queued". Tapping it opens the sync sheet. A sheet, not a route, so `routes.ts` and `src/ai/surfaces.ts` stay untouched and `check-route-surfaces.ts` has nothing new to verify.
- **Sync sheet**: last synced (relative and absolute), what is in the mirror (n reports, oldest date), pending intents with their kind and target, failed intents with retry and discard, "Sync now", and "Clear offline data" which wipes the mirror but refuses while anything is queued.
- **Per-row pending state**: a small "queued" chip on a note or a rating that has not reached the server. Optimistic, but never pretending it is durable.
- **Stale banner** on a report read from the mirror with a sync older than 24 hours.
- **Tier B pages**: `OfflineNotice` with the page name and one line on why it needs the connection, rather than a browser error.
- **The assistant widget** is hidden or disabled offline. It needs the model, and a chat box that swallows a message is worse than no chat box.

All of it checked at 390x844 on the actual phone, with the VPN actually off. The project's rule is that a desktop viewport resized narrow is not that check, and for this feature DevTools offline mode is not that check either: it does not reproduce "WiFi up, tunnel down", which is the entire case.

---

## 10. The decision that needs an explicit yes

Today every byte of personal content stays behind the wg0 ACL, and the dashboard has no login because that ACL is the whole boundary. This feature deliberately moves a copy of the briefing archive, the notes, the standing rules and the harvested context document onto the phone's storage, **outside that boundary**, where it is protected by the device lock and the OS disk encryption and nothing else. An unlocked or compromised phone reads the personal section of 60 briefings without touching the VPN.

That is a real change to the threat model in `SECURITY_PLAN.md` §0 and it is the owner's call, not an implementation detail. What the plan already does to keep it proportionate: raw message bodies never leave the server, the window is bounded at 60 days, and "Clear offline data" is one tap. What it does not do: encrypt the mirror. A key the app can use unattended is a key an attacker with the device has, so it would be ceremony, not protection; the honest control is the device lock.

If the answer is yes, it belongs in `CONTEXT_AND_DECISIONS.md` as a dated decision in the same form as the others. If the answer is a smaller window (7 days, say), only `MIRROR_DAYS` changes.

---

## 11. Phases

Each phase is independently shippable and leaves the app better than it found it.

**O0 - preconditions.** The SvelteKit 3 migration in the working tree (91 modified files, `MIGRATION_TASKS.md`) and the triage/gate feature must be committed first. O1 to O4 touch the same page loads, the same form actions and the same `invalidateAll` call sites that the migration is rewriting; doing both at once produces a merge no one can review.

**O1 - the shell survives a cold start.** `src/service-worker.ts` with the build-time asset list, shell capture and fallback, the push handler moved over, the `/sw.js` migration, the nginx `no-cache` rebuild on pronix. No data layer yet.
*Done when:* the phone in airplane mode opens the installed app and gets the shell, the navbar and an honest offline state instead of the browser's error page, and DevTools shows exactly one registered worker with caches named for the current build.

**O2 - the mirror and the read tier.** `/api/offline/snapshot`, `db.ts`, `sync.ts`, `repo.ts`, Tier A pages converted from `+page.server.ts` to `+page.ts` with `ssr = false`, the `/` offline resolution, `lastSyncedAt` on screen.
*Done when:* with wg0 down, the last 60 reports, their detail cards, the notes list, the rules and the context document all render, and each says when it was synced.

**O3 - the outbox.** `outbox.ts`, the `POST /api/feedback` and `/api/rules` endpoints, the optional `id` on `createNote`, optimistic application, flush triggers, ordering, retry, the failed list.
*Done when:* offline, a note is created, edited and deleted, two items are rated and a rule is changed; the VPN comes back and every one lands with the right `created_by`/`updated_by` and a `note_revisions` row per mutation. Replaying the same queue twice changes nothing.

**O4 - status, conflicts and honesty.** `state.svelte.ts`, the header indicator, the sync sheet, pending chips, the stale banner, `OfflineNotice` on Tier B, the changed-on-the-server flag, clear offline data.
*Done when:* every offline state on every route is a designed state.

**O5 - the device pass and the deploy.** Now runs after H1 to H4 and as part of H5 (§14), with the three failure modes listed there. The 390x844 checklist with the VPN genuinely off: cold start, navigate all of Tier A, write in every allowed way, force-quit, reopen still offline (the queue survives), reconnect, watch it flush, verify the rows in Postgres. Then `bun run deploy`, with the pronix `nixos-rebuild` for the nginx header done separately and first.

---

## 12. Risks

- **The shell boot.** Validated against the runtime rather than assumed (§3), but the spike at the start of O1 is still the first thing to do, because everything downstream depends on it. Fallback is the prerendered `ssr = false` route.
- **Losing SSR on the report page.** Accepted on purpose: with the shell and the mirror cached this is faster for a repeat reader, not slower. The thing to watch is the first visit on a fresh device, which is now shell plus two round trips instead of one.
- **Storage eviction.** Browsers may clear script-writable storage for sites that go unused, and the policies change. The mirror is therefore always rebuildable from the snapshot endpoint and must never be the only copy of anything. The outbox is the exception that matters: it holds writes that exist nowhere else, so it stays small, it flushes at every opportunity, and the sync sheet makes a non-empty queue visible rather than quietly durable.
- **A stale mirror read as current.** Mitigated by never showing a report without its date and its sync age, and by `/` resolving to the newest cached day rather than to today.
- **Two workers, one app.** Covered in §7; it is the single most likely way this ships broken and invisible.
- **`bun run check` and the guards.** No new route means `check-route-surfaces.ts` is unaffected. `check-skill-writes.ts` is unaffected because no skill is touched. `dashboard/scripts/contrast.ts` covers the new indicator and sheet colours, which must come from the existing palette.

---

## 13. Out of scope for v1

- Offline search. `search.ts` is Postgres `tsvector`; the palette will search the mirror with a plain substring match over the cached reports and notes and say that it is doing so. A local index is not worth it before the archive is deep, and the semantic-search project in `TODO.md` is where that conversation belongs.
- Offline chat, skill execution, pipeline triggers, prompt approval, question gates.
- Corrections and contact edits (§1).
- Multi-device conflict resolution beyond "apply and flag".
- Encrypting the mirror (§10).

---

## 14. Field report 2026-09-25 and the hardening phases (H1-H5)

O1 to O4 shipped; the first real use on the installed PWA failed in exactly the case this plan exists for. Observed on the phone: VPN app on, app opened, **initial load much slower than it should be**. Mobile data then switched off, **Questions** tapped: a spinner for a long time, then a timeout, then the app chrome with **"500 Internal Error"** in the page slot.

**The rule that was missing, stated so it can be checked:**

> **No screen ever waits on the network when a local answer exists, and no request, of any kind, from any caller, can outlive a fixed budget.** A timeout is not an error state the UI handles; it is a state the architecture makes unreachable.

O1 to O4 treated "offline" as fail-fast (a `TypeError` from `fetch`). The real failure mode is a **blackhole**: the VPN app is still up with no network underneath, or wg0 is down and `pidra.ileies.de` resolves to `10.200.200.1`, which on a foreign network is usually nobody. Packets leave and nothing ever answers, so every request waits for the OS connect timeout. Reproduced from the workstation off-VPN on 2026-09-25: `/api/health`, `/api/nav-badges`, `/api/offline/snapshot` and `/` each hung the full 30 s curl budget with no response at all (status `000`), none of them failed early. DevTools' offline mode is fail-fast and therefore **cannot** reproduce this; it is why the bug survived O4.

### 14.1 Root causes

**The Questions timeout.** `/questions` is Tier B and still has a server `load`. A client-side navigation fetches `/questions/__data.json` through SvelteKit's own `window.fetch(data_url.href, {})`, with no signal and no timeout (`node_modules/@sveltejs/kit/src/runtime/client/client.js:3640`). The service worker does not intercept it (`service-worker.ts` only handles `/_app/immutable/`, fonts, icons and `mode === "navigate"`), so nothing anywhere bounds it. `data-sveltekit-preload-data="hover"` in `app.html` fires the same request on touchstart, so the hang starts even before the tap completes. Every other Tier B route (`/sources`, `/sources/[name]`, `/feedback`, `/skills`, `/prompts`, `/runs`, `/chat`, `/[date]/triage`) and the three Tier A routes that were never converted (`/entities`, `/entities/[id]`, `/contacts`, `/topics`) have the same hole.

**The "500 Internal Error".** When that fetch finally throws, SvelteKit maps an unknown error to `{ status: 500, message: "Internal Error" }` (`client.js:2503`). `+error.svelte` only swaps in `OfflineNotice` when `offline.reachable !== "online"`, but that state is only moved by `/api/health` probes on start, on `online`, and on `visibilitychange`. Switching mobile data off with the VPN app still up fires none of those, and the failed `__data.json` fetch and every failed `pull()` never report back to the state. So the state still said online and the plain error page rendered. The design decided connectivity from a separate probe instead of from the request that actually failed.

**The slow start, online.** Every `repo` read is network-first in disguise. `withMirror()` (`repo.ts`) awaits `pull()` before it reads the mirror, and `pull()` awaits `outbox.flush()` before it fetches the **full** snapshot: 645,254 bytes, 0.25 to 0.28 s of server time measured on pronix, served uncompressed by the Node process (whether nginx compresses it on the wire is unverified), then a full replace of every IndexedDB store. Cold start runs this twice in series: `/` awaits `pull()` to decide where to redirect, then `/[date]` awaits `report()`, which pulls again. The same full pull runs on every day step, every tap-preload of a Tier A link, every `invalidateAll()` after an outbox write, and **every keystroke in the notes search**, because `notes/+page.svelte:61` drives the filter through `goto()` and so through the load. Nothing is single-flight, so overlapping calls download the snapshot in parallel.

**The slow start, offline.** The same chain with the 8 s abort on each step: up to 8 s for `flush()` when anything is queued, 8 s for the snapshot, twice for `/` then `/[date]`, with the root layout's 4 s `nav-badges` budget beside it. A cold start offline can sit behind 16 to 32 s of timers before the mirror is read, and in the blackhole case every one of them is actually used. "Local-first" in O2 was local-last.

### 14.2 Everything else found in the same pass

Service worker (`dashboard/src/service-worker.ts`):

1. **No shell fallback.** O1 and O2 described a route-agnostic `shell.html`; the worker still caches navigations one per path (its own header comment says so). A Tier A path never visited while online shows the browser's offline page.
2. **Navigations are network-first without a budget.** `networkFirstNavigation()` awaits `fetch(request)` with no timeout, so a reload or a cold start in the blackhole case hangs for the OS timeout before it even looks at the cache.
3. **A non-OK navigation is returned as-is.** VPN off with DNS still answering the public wildcard gives nginx's 403 page, and the worker hands it to the app as the document.
4. **`cacheFirst()` falls through to an unbounded `fetch()`** on a cache miss.
5. **`skipWaiting()` plus deleting every other version's cache on activate** pulls the chunks out from under a page that is still running the previous build. The next lazy route chunk that page asks for misses the cache, goes to the network, and either 404s (online, after a deploy) or hangs (offline).
6. **The `push` handler does not sync.** §6 trigger 4 (pull on the 06:30 notification so the briefing is in the mirror before the train) was never built, and neither was Background Sync (§6 trigger 3).
7. **No navigation preload** (`registration.navigationPreload`), so the online network-first path for Tier B pays worker boot plus request serially.
8. **Install precaches all 186 build files at once**, competing with the app's own first requests on the same VPN link.

Client fetches with no budget, each one a possible hang:

| Caller | Request | What it should do instead |
|---|---|---|
| `[date]/detail/[ids]`, every Tier B route | SvelteKit's `__data.json` | bounded by the worker (H1) |
| `ReportEntry.svelte:44` (inline source expansion) | `/api/extractions` | read the mirror, which already holds these extractions |
| `DayNav.svelte:43` (archive picker) | `/api/reports/archive` | read `repo.reportDates()` |
| `CommandPalette.svelte:75` | `/api/search` | mirror substring search offline, as §13 promised |
| `notes/api.ts` `call()` | `/api/notes/*` (history panel, revert) | budget, and a designed offline state |
| `assistant/state.svelte.ts` | `/api/assistant/surfaces`, `/api/assistant/chat` | budget on connect; hidden offline already |
| `NotifyButton.svelte` | `/api/push/subscribe` | budget, disabled offline |
| `[date]/+page.svelte:116` | `/api/pipeline/status` every 5 s via `setInterval` | self-scheduling `setTimeout` after completion, paused offline and hidden; `setInterval` over a blackhole piles up a new hung request every tick |
| `context-builder/+page.svelte:84` | `/api/context-builder/status` every 2 s | same |
| every `use:enhance` form on a server-action page | form action POST | disabled offline with a reason; budgeted when online |

Plan items O2 promised that did not land: `/entities`, `/entities/[id]`, `/contacts` and `/topics` are Tier A in §1 but still `+page.server.ts` and absent from the snapshot; offline search (§13) does not exist; the §5 `since` delta was dropped in favour of a full pull on every sync, which is only cheap while syncs are rare, and the read path made them constant.

### 14.3 Phases

Ordered so the reported bug is gone after H1 alone. Each phase is shippable on its own.

**H1 - no request can hang.** Fixes the Questions timeout and the 500. *Built 2026-09-25; what follows is what shipped, which differs from the first draft of this section where noted.*

- **`$lib/offline/net.ts`, the one client-side `fetch`, and the one owner of reachability.** Every request has a hard ceiling (3 s probe, 15 s interactive, 30 s page data, 60 s sync) and its body is read inside it. Slow is told apart from gone **by asking**: a request still waiting after 500 ms starts one shared probe of `/api/health`; if the probe fails, the state flips to offline and every request in flight is aborted at once, if it answers, the request keeps its budget and ends as `NetError("slow")` at worst, never as "offline". Known offline, every non-probe request fails in the same frame with `NetError("offline", sent: false)`. A response without the `x-pidra` stamp that `hooks.server.ts` now puts on every response (nginx's 403, a captive portal) counts as offline. The first draft had fixed short timeouts decide offline on their own; that would have called a slow `/runs` query "offline".
- **SvelteKit's own requests go through it too**, by the client, not the worker (first draft: a worker intercept). `load_data` and `enhance` read `window.fetch` at call time, which SvelteKit documents as the hook for a patched fetch, so `guardKitFetch()` in `hooks.client.ts` routes exactly `__data.json` and form-action requests through `net()`. Page data that cannot arrive becomes a `503` whose JSON body carries `offline: true`, which SvelteKit spreads into `page.error`. A form action that cannot arrive answers as a `failure` with `form.error` set, so every page's existing error display shows "Not sent: needs the connection. What you entered is still here." and the typed input survives, where the first draft wanted every such form disabled offline one by one.
- **`state.svelte.ts` mirrors `net.ts`** instead of running its own probe schedule. It only owns the way back: probe every 20 s while offline and visible (60 s after ten failures), on `online`, and on foregrounding. The worker and the page share one belief: `net.ts` posts every change to the worker, and `hooks.client.ts` asks the worker at start, so a page booted from the shell after a failed navigation renders from the mirror without waiting on a probe.
- **The worker bounds navigations.** Network against a 3 s budget, then the cached shell, then a static "nothing stored yet" page, never the browser's error page. The shell is any response stamped `x-pidra-shell` (mirrored routes only, `ssr = false`), plus one fetched at install so the first offline start after a deploy has one. Server-rendered pages are no longer cached per path at all. A response without `x-pidra` is never used as the document. This pulls the H2 fallback item forward; cache-first shell stays in H2.
- **`+error.svelte` decides from `page.error.offline`**, set by `net.ts` or by `handleError` in `hooks.client.ts`, never from the header dot. A connectivity failure renders `OfflineNotice` with the page's name and reason, resolved from the URL because SvelteKit leaves `page.route.id` null when the data never arrived; it retries by itself when reachability returns. A real error keeps its status and gains Try again. The "500 between the logo and the navigation" was simply the error page in the page slot between the header and the tab bar, not a layout bug.
- **The tiers live in `routes.ts`** (`MIRRORED_ROUTES`, `ONLINE_ONLY` per route id). `/entities`, `/entities/[id]`, `/contacts` and `/topics` are online-only until H3 mirrors them. Offline, those entries in the navbar and the More sheet are marked "Needs the connection" and do not preload on touch.
- **Polling** (`/[date]` pipeline status, `/context-builder` status) goes through `$lib/offline/poll.ts`: next tick only after the last one settled, paused while hidden or offline.
- **`dashboard/scripts/check-offline.ts`** in the dashboard's `bun run check`: fails on a bare `fetch(` in client code, on a page in no tier or in both, and on a mirrored page that is not `ssr = false` or still has a server load.

*Measured* against a local production build in headless Chrome, with requests swallowed rather than failed: tap Questions while the app still believes it is online, notice in **3.9 s**, no "Internal Error", dot offline; any online-only tap after that **~50 ms**; Notes from the mirror **~50 ms**; Try again after reconnecting **65 ms**, and foregrounding brings the page back by itself; a full reload of `/questions` into the blackhole reaches the notice in **3.1 s** via the shell, and the next reload of a mirrored page renders in **~65 ms**; nginx-style 403 answers are recognised in **~55 ms**. Still open for H1's claim: the phone itself (H5).

**H2 - local-first for real.** Fixes the slow start. *Built 2026-09-25; the list below is the brief, and the notes after it say where what shipped differs.*

- **Stale-while-revalidate in `repo.ts`.** `withMirror()` reads the mirror and returns immediately. Only when the mirror is empty (first launch on a device, or right after "Clear offline data") does a load await a pull, and then under the background budget with an explicit empty state if it fails. Every other read schedules a background sync and never awaits it.
- **`sync.ts` becomes single-flight and throttled.** One pull in flight at a time; concurrent callers share its promise; a pull at most every 60 s unless forced ("Sync now", app start, becoming visible after more than 5 minutes hidden, the push event). A pull that changed something calls `invalidate("mirror:<store>")` for the stores it touched, and each Tier A load declares `depends("mirror:<store>")`, so a finished sync re-renders exactly the pages that read what changed. `invalidateAll()` is retired from the offline paths, since it also re-runs the root layout.
- **Outbox writes re-render from the mirror, not the network.** After `enqueue()` the page invalidates the mirror dependency; `flush()` runs in the background and never sits between the tap and the re-render.
- **Notes search filters in the component.** The load returns the notes; the query, scope, sort and view filter in a `$derived` over them, and the URL is updated with `replaceState` for shareability without re-running the load. Same for any other filter that is currently a `goto()`.
- **`/` never waits.** It redirects to today when today is mirrored, otherwise to the newest mirrored date, with the date and the sync age explicit (§7). When a background sync then brings today's report, the page offers it ("Today's briefing is here") rather than silently swapping the text under the reader. First launch with an empty mirror is the one case that waits, and it shows a designed "first sync" state rather than a blank loading bar.
- **The shell, finally.** Every Tier A route is `ssr = false`, so its HTML is route-agnostic. The worker serves a cached `shell.html` **cache-first** for every Tier A navigation, including cold start online, and refreshes it in the background. That removes a network round trip from every launch, online or not. If runtime capture of the shell proves unreliable, fall back to a prerendered `ssr = false` route as §7 already describes.
- **Root layout load stops blocking.** `+layout.ts` currently awaits `/api/nav-badges` (4 s budget) on every cold start. Badges become a component-level background fetch in `Navbar`/`TabBar` through `net()`, rendering none until they arrive.
- **Cheaper syncs.**
  - `ETag` on the snapshot: the server derives a version from `max(updated_at)`/`count` over the mirrored tables plus the build version and answers `304 Not Modified` on a match. The typical sync on a day with no change becomes a few hundred bytes.
  - Restore the `since` delta from §5 once the 304 path exists, so a sync on a day with a new report ships that report, not all 60.
  - Cache the assembled snapshot in the dashboard process keyed on that version, so 60 `renderReport()` calls do not run on every request.
  - Confirm on the wire that nginx gzips or brotlis the proxied JSON (`recommendedGzipSettings` should cover `application/json` with `gzip_proxied any`), measured from the phone, not assumed.
  - Apply a snapshot in one IndexedDB transaction and skip rows whose content hash is unchanged, instead of rewriting every store on every pull.
- **Deploys stop breaking open pages.** No automatic `skipWaiting()`; the new worker waits, the app shows "New version, tap to reload" and activates it on tap or on the next cold start. Keep the previous version's cache one generation longer so a page that is still running can load its chunks.
- **Install stops competing.** Precache with a small concurrency limit, and let the app's own first requests go first.
- **`navigator.storage.persist()`** once, on the first successful sync, so the browser does not evict the mirror or the outbox under storage pressure (§12 risk). The sync sheet shows whether persistence was granted.

*Done when:* online, a cold start of the installed app paints the newest mirrored report from cache before any network request completes, and a measured cold start on the phone over the VPN is under 1 s to first report text. Offline, the same start is indistinguishable in speed.

*What shipped, where it differs from the brief:*

- **No load awaits a pull, not even on an empty mirror.** Every `repo` read takes the load's `depends`, registers `mirror:<store>` plus `mirror:status`, and starts a throttled background `sync()`. An empty mirror makes the load return `mirrorEmpty: true`; the root layout renders `FirstSync` in the page's place, and the sync that fills the mirror invalidates `mirror:status`, which re-runs the load (and makes `/` redirect). That is the designed first-sync state for every mirrored path, not only `/`, and the first frame is already right because it is decided from the load's answer, not from a state that loads later. `repo` now returns plain data: every read comes from the mirror, so `source` said nothing, and the sync age is `offline.lastSyncedAt`.
- **The outbox invalidates, not the page.** `enqueue()` resolves after the optimistic write and the invalidation of exactly the stores it touched, so no page can forget to, and `refreshAll()` is gone from every offline path. Writes that go to the server directly (a note revert, a correction revert, a finished pipeline run or Context Builder run, an assistant turn that wrote something) force a sync instead.
- **The delta is against the client's ETag, not `since=<timestamp>`.** The server keeps the row hashes of the last eight snapshot versions it built; a client whose ETag is one of them gets only the rows whose hash changed, plus every id per store so deletions prune. A timestamp delta would miss everything that moves no timestamp here: `daily_reports` has no `updated_at`, a rating toggled off is a delete, a run flipping to `failed` sets no column a delta could key on. A restarted process simply answers in full. The cache key is a fingerprint that hashes every mirrored row inside Postgres (`t::text`), not `max(updated_at)`/`count`, for the same reason; the assembly is also rebuilt at least every 10 minutes because the harvest document is a file, not a row. The ETag travels in the body as well as the header, because nginx weakens a header ETag when it compresses. `#lib/server/snapshotCache.ts`.
- **nginx does compress it**, measured on pronix through nginx rather than from the phone: 645 kB raw, 178 kB gzip, 143 kB brotli. Nothing to change.
- **Badges** live in `$lib/navBadges.svelte.ts`, refreshed whenever `page.data` reloads (a navigation or a form action's invalidation, which is when a count can move), throttled, hidden while offline. The root `+layout.ts` is deleted.
- **The update handover** is `$lib/offline/update.svelte.ts` plus a bar under the header. It also calls `registration.update()` on foregrounding at most every 30 minutes, because the browser's own check runs only on full navigations. Generations are recorded in a `pidra-meta` cache rather than inferred from version strings, and asset lookups go through `caches.match` so either generation answers.
- **Two bugs the H2 testing found, both older than H2:**
  - SvelteKit's default relative asset paths made the shell depth-dependent: captured at `/notes` it says `./_app/...`, which at `/2026-09-25/detail/<ids>` resolves two levels too deep, and SvelteKit derives its `base` from `location` the same way. Latent since H1's fallback; cache-first would have hit it on every deep launch. `paths.relative = false` in `vite.config.ts`.
  - Every navigation that ends at status 400 or more awaits SvelteKit's `updated.check()`, an unbudgeted `fetch` of `/_app/version.json`, before rendering, so in a blackhole the error page, `OfflineNotice` included, never appeared. `guardKitFetch()` now bounds it (3 s, not sent while known offline). It cannot go through `net()`: adapter-node serves static files before the hooks, so they carry no `x-pidra` stamp.
- `check-offline.ts` also fails a mirrored `+page.ts` that awaits a sync or makes a request.

*Measured* against a local production build in headless Chrome at 390×844, through a proxy that either forwards or accepts and never answers: first launch shows the first-sync state and the report after 1.2 s (one full pull over an SSH tunnel to Postgres); a cold start online renders report text in **136 ms**, with one `304` of 0 bytes as the only snapshot traffic; a cold start in the blackhole in **103 ms**; a deep `/…/detail/<ids>` cold start in the blackhole in **82 ms**; typing in the notes search sends no snapshot request; the Questions tap in the blackhole **18 ms**, a full reload of `/questions` there 3.1 s (the navigation budget). A rebuild installs a waiting worker, the page stays on the old build and shows the bar after 2.6 s, Reload activates the new one, and both generations' caches remain. Still open for H2's claim: the sub-second cold start measured **on the phone over the VPN** (H5).

**H3 - close the gaps O2 left.** *Built 2026-09-25; the list below is the brief, and the notes after it say where what shipped differs.*

- `ReportEntry` inline expansion and `DayNav` archive read the mirror (`repo.extractionsFor`, `repo.reportDates`), with the network as the refresh, not the source.
- `/entities`, `/entities/[id]`, `/contacts`, `/topics` move to `ssr = false` and the mirror, list fields only, as §1 and §4 already specify. Their writes (corrections, topic status) stay online-only per §1 and are disabled offline with the reason.
- Offline search in `CommandPalette`: when offline, a substring search over mirrored reports, notes and rules, labelled as such (§13).
- The `push` handler runs the same single-flight sync inside `event.waitUntil`, so the 06:30 briefing is in the mirror before the notification is tapped. Where `periodicSync` exists (Chrome on Android for an installed PWA), register it for a daily refresh; where `sync` exists, register `pidra-outbox` so queued writes flush without the app being opened.
- Optional, owner's call: a **read-only "last seen" copy** of `/runs` and `/sources`, labelled with its age, since neither page acts on what it shows. `/questions`, `/skills`, `/prompts` and `/chat` stay online-only, because acting on a stale gate or approval is the harm §1 names.

*What shipped, where it differs from the brief:*

- **The reference tables are mirrored whole**, not as list fields: 447 entities, 91 relations, 14 contacts and 84 topics were about 180 kB of JSON on 2026-09-25 (the full snapshot went from 645 to 864 kB raw), and the detail page needs nearly every column anyway. `entity_appearances` is the one set that grows per report day, so it is bounded to the report window like the extractions. The fingerprint hashes all five tables' rows; it used to count two of them. IndexedDB goes to version 2 for the new stores, and a connection now closes on `versionchange` so an upgrade in another context is not blocked by it.
- **Filtering moved into the components**, from the URL the existing GET forms and chips write. The loads read no URL, so a filter change re-renders and never re-runs a load (H2's rule for the notes search, applied to the rest).
- **The online-only writes are disabled once the app knows it is offline**, with one line saying why, and a success forces a sync, since those writes reach the mirror only through a pull. On a cold start in the blackhole that is 3.1 s in (the probe budget), and at once on every load after it, because the worker's hint is already there. A tap before that is still covered by H1: the form answers "Not sent" and keeps what was typed.
- **`/api/extractions` and `/api/reports/archive` are deleted**: with the expansion and the picker on the mirror, nothing called them.
- **Offline search covers entities too**, since they are mirrored now, and marks its matches as plain text rather than through `{@html}`. It runs only when the server search cannot: known offline, or a request that turned out offline.
- **The worker runs the pages' code, not a copy.** The outbox core moved to `$lib/offline/intents.ts` and the pull to `$lib/offline/snapshot.ts`, neither of which touches `window` or the router; the transport is handed in (`net()` in a page, a 20 s-bounded `fetch` in the worker, with the same `x-pidra` rule). Two Web Locks (`pidra-outbox`, `pidra-snapshot`) keep a page and the worker from sending the same intent twice or applying two snapshots at once, and the worker posts the changed stores to any open page, which re-renders exactly those. Background Sync is registered only when a write is still queued after the page's own flush, and its handler rejects while the queue is not empty, so the browser retries on its own schedule. The periodic sync (`pidra-mirror`, 12 h hint) is registered only where the permission is already granted.
- **A bug the testing found, older than H3:** the push notification named its icon by path, and the browser fetches that from the origin before it shows anything, outside the worker and without a budget. With the icon not in the HTTP cache, a push in the blackhole showed nothing for over 40 s. The worker now hands over the precached icon as a `data:` URL, and leaves it out rather than wait when it has no copy.
- **Not built:** the optional read-only copy of `/runs` and `/sources`. It is the owner's call, and it is still open.

*Measured* against a local production build in headless Chrome at 390×844, through a TCP proxy that either forwards or accepts and never answers, with the worker's events fired over CDP and a stand-in for the skills bridge so no test write reached the database: a cold start in the blackhole renders `/entities`, `/entities/<id>`, `/contacts`, `/topics` and a report in **about 100 ms** each; the inline sources open in **61 ms** and the archive lists all 18 mirrored days, both in the blackhole; the palette answers from the mirror **about 200 ms** after typing, the 180 ms debounce included. A queued note staged with the app closed was delivered by a `pidra-outbox` sync event, which then pulled; a push restored a report deleted from the mirror, and a periodic sync corrected a row on a page left open, which re-rendered without a reload. In the blackhole, the push notification now shows after **108 ms**. Still open for H3's claim: Background Sync and periodic sync exist only on Chrome for Android, and iOS has neither, so on the phone the push is the path that matters, and it has not been fired at the phone yet (H5).

**H4 - honesty where it is still missing.**

- The header dot starts as "checking", never as "online", and changes on the first real request's outcome.
- A pending row that failed terminally is visible in place, not only in the sync sheet.
- Every Tier A page reads "synced 2 h ago" from the mirror's own timestamp, including after a successful background refresh that changed nothing.
- The loading bar (`navigating.to`) only ever reflects work the user is actually waiting for; after H2 that is the first-launch case alone.

**H5 - make "no timeout" provable, then do the device pass (O5).**

- **A blackhole test**, which is the one DevTools cannot give: Playwright against a production build, with a route handler that never fulfils any request to the origin (`page.route("**", () => {})`). For every entry in `routes.ts`: cold start, client-side navigation to it, and a tap on each primary control, asserting a designed state within 4 s and no request left pending past its budget. The same suite runs in two more modes: fail-fast (`context.setOffline(true)`) and gated (every request answered with nginx's 403 HTML).
- `check-offline.ts` from H1 stays in `bun run check`; the blackhole suite joins it.
- Then O5 on the actual phone at 390×844, in all three real modes: VPN app on with mobile data off (blackhole), VPN off on WiFi (the `10.200.200.1` blackhole), VPN off with DNS returning the public address (gated). Cold start, every route, every allowed write, force-quit, reopen offline, reconnect, watch the flush, check the rows in Postgres.

---

## 15. When this lands

Per the project's convention, this file is deleted on completion and anything still open moves to `TODO.md`. What outlives it:

- **CLAUDE.md**, Dashboard conventions: Tier A pages are `ssr = false` and read through `$lib/offline/repo.ts`; the mirror is a cache and a queue, never a source of truth; no page writes the mirror directly; `renderMarkdown()` stays server-side and the snapshot ships rendered HTML.
- **CLAUDE.md**, Dashboard conventions: client code never calls `fetch` directly; `$lib/offline/net.ts` is the one caller and owns the budgets, and `dashboard/scripts/check-offline.ts` enforces it. No load awaits the network when the mirror has an answer.
- **CLAUDE.md**, Deployment: `/service-worker.js` needs the nginx `no-cache` header, which is a `nixos-rebuild` on pronix and not part of a deploy.
- **CONTEXT_AND_DECISIONS.md**: the dated decision from §10.
- Code comments carry the rest, as they do everywhere else here.
