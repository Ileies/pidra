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

**O5 - the device pass and the deploy.** The 390x844 checklist with the VPN genuinely off: cold start, navigate all of Tier A, write in every allowed way, force-quit, reopen still offline (the queue survives), reconnect, watch it flush, verify the rows in Postgres. Then `bun run deploy`, with the pronix `nixos-rebuild` for the nginx header done separately and first.

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

## 14. When this lands

Per the project's convention, this file is deleted on completion and anything still open moves to `TODO.md`. What outlives it:

- **CLAUDE.md**, Dashboard conventions: Tier A pages are `ssr = false` and read through `$lib/offline/repo.ts`; the mirror is a cache and a queue, never a source of truth; no page writes the mirror directly; `renderMarkdown()` stays server-side and the snapshot ships rendered HTML.
- **CLAUDE.md**, Deployment: `/service-worker.js` needs the nginx `no-cache` header, which is a `nixos-rebuild` on pronix and not part of a deploy.
- **CONTEXT_AND_DECISIONS.md**: the dated decision from §10.
- Code comments carry the rest, as they do everywhere else here.
