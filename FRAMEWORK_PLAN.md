# Framework plan

Status: proposed, 2026-10-13. This is a design proposal and a decision list, not authorization to build, to change `docs/architecture-rules.md`, or to ingest any new source. Nothing here has been started.

Source of this plan: a design conversation with the owner. The repo was read only for `docs/architecture-rules.md`, `CLAUDE.md`, `src/server/routes/sms.ts` and `MULTI_USER_PLAN.md`. The extraction schema, `contacts` table and Context Builder were not audited; Phase 0 does that. Things that could not be verified are listed in "Not verified" at the end.

## 1. Idea

Split PIDRA into a shared framework and an app on top of it.

- **The framework** ingests every personal source once (email, SMS, Google Calendar, Tasks and Keep, GitHub, later Slack and others), filters credentials at the fetch choke point, stores raw items, runs one neutral classification per item, owns the contact directory and the long-term context document, and has its own calendar, notes and tasks. It exposes all of it through one typed API.
- **Apps** call that API with specific requests. PIDRA is the first app and the demonstration. The owner plans two more productivity apps later, all sharing one index.
- **PIDRA shrinks** to what is its own: the news desks, the relevance gate, synthesis, the questions queue, quick actions, the assistant and the dashboard.

Why it is worth doing: ingest, dedupe, credential filtering and storage are the same job for every app. The multi-user plan's tenancy, per-user connectors and OAuth also belong in the framework, not in one app.

## 2. Decisions already made by the owner

| # | Decision | Notes |
|---|---|---|
| F1 | Contacts are shared across apps | Identity is shared, triage weight is a per-app overlay (section 4.2) |
| F2 | The context document is shared across apps | The `# 1.` to `# 5.` contract becomes a versioned framework output (section 4.3) |
| F3 | Entities were removed from PIDRA entirely | Nothing to place. The five legacy `entity` corrections stay readable per `architecture-rules.md` |

## 3. Boundary: what lives where

| Concern | Framework | PIDRA |
|---|---|---|
| Fetching IMAP, SMS, Google, GitHub, Keep | Yes, with the credential filter at the fetch choke point | No |
| Raw items and drop logs (`ingest_drops`) | Yes, exposed to apps through the API | Shows them on the dashboard |
| Ingest failure reporting | Produces `step_errors` style records | `IngestWarning` renders them |
| Neutral classification | Yes (section 4.1) | No |
| Relevance gate, trust scores, topic lifecycle | No | Yes |
| Contacts, identity | Yes | Triage weight overlay |
| Context Builder harvest and document | Yes | Reads sections it needs |
| `context_corrections` for `document` and `contact` | Yes, single writer stays | Writes through the API |
| Calendar, tasks, notes (generic user content) | Yes | Reads and writes through the API |
| Steering notes (`steps`, `applies_to`, `note_loads`) | No | Yes, stays in PIDRA (decision F4 below) |
| Newsletters, RSS, web news | No, for now | Yes |
| Synthesis, reports, report audio | No | Yes (reports are final) |
| Questions queue, quick actions, assistant surfaces | No | Yes |
| Prompt approval flow | Per app | Yes |
| Tenancy, auth, billing | Yes | Consumes it |

**F4, notes (proposed):** the framework's notes are generic user content. PIDRA's steering notes (`notes.steps`, `notes.applies_to`, load tracking, `selectNotes`) stay in PIDRA because they exist to steer PIDRA's prompts. Two notes systems is the risk. Phase 0 must decide whether the framework's notes can be one table with an app-owned steering overlay, which is how contacts are handled.

## 4. Design

### 4.1 Neutral classification

Classification today is tuned to PIDRA: it reads PIDRA's notes, targeting and contacts. A framework that classifies once for all apps can only emit neutral facts. Relevance stays in each app.

1. **Audit** the current extraction schema field by field and tag each field:
   - Neutral fact: sender, item type, dates and times, named things as raw strings, requested actions, language, a sensitivity flag.
   - Interpretation: relevance, urgency for this reader, gate signals. These stay in PIDRA.
2. **Second pass API:** the framework keeps raw items. An app can ask "interpret item X with my prompt and schema" and gets JSON back. This is the escape hatch for anything the neutral pass dropped, and it keeps the two-stage rule honest: the app's synthesis still never sees raw email HTML. Apps do not bulk-read raw content.
3. **Shadow run:** PIDRA runs on the framework's neutral output while the current path still runs. Compare gate outcomes with the existing dry-run scripts and the triage page for one to two weeks. Move over only when outcomes match.
4. **Cost check:** a neutral pass plus an app pass can mean two model calls per item where there is one today. Measure it in the shadow run before committing.
5. Newsletters, RSS and web news stay out of the framework until a second app wants them.

### 4.2 Contacts

Split the row: identity (name, addresses, numbers, relationship, `removed_at`) is framework-owned. Triage weight is a per-app overlay keyed by contact id. The framework links messages from any channel to an existing contact by address or number match. See section 6 for contact creation.

### 4.3 Context document

- The Context Builder harvest moves to the framework. It reads all sources, so it belongs next to the connectors.
- The `# 1.` to `# 5.` headings are an interface today (`pickSections`, the shared `DOCUMENT_STRUCTURE` constant, the verification in `context-builder/phases/synthesize.ts`). Once shared, that contract is the framework's, versioned, and every app that reads the document follows it. Changing it needs a version bump and a consumer check. Never let one app's needs reshape it silently.
- Corrections of kind `document` and `contact` move to the framework with the single-writer rule intact. The append-only and revert semantics do not change.

### 4.4 Internal boundary first

No separate service until a second app exists.

1. Create a `framework/` module inside this repo with ingest, storage, neutral classification, contacts, context and a typed API. PIDRA calls it only through that API.
2. Add a check script in the style of `scripts/check-skill-writes.ts` that fails the build when PIDRA reads or writes a framework table directly. That is the test of whether the seam holds.
3. Extract to a service only when the second app starts and the API has survived real use. The API shape will change when the second app has real needs, and designing for imagined consumers is the main risk of this plan.

### 4.5 Order relative to the multi-user plan

Tenancy, per-user connectors and OAuth in `MULTI_USER_PLAN.md` belong to the framework. Decide this plan's boundary before executing the multi-user plan, or its Phase 1 and 2 will be reworked at extraction time.

## 5. Phone app

One native Android app, built once, with the dashboard as its UI. No second UI.

- **Shell:** a WebView pointing at the dashboard. Cookies use the normal WebView store.
- **Bridge:** a small JS interface, for example `window.PidraNative`, with `capabilities()`, `getCaptureStatus()`, `setCaptureEnabled(kind, bool)`, `requestPermission(kind)`, `openSystemSettings(kind)` and `getQueueStats()`. No call returns message content.
- **Settings route:** a section in `dashboard/` that renders only when `window.PidraNative` exists, and lists only what `capabilities()` reports. In a normal browser it shows nothing, or a link to the full app.
- **Data path:** captured items go from native code straight to the framework ingest endpoint with a per-user token, through a WorkManager queue with retry and backoff. They never pass through the web layer.
- **Two flavors, one codebase:**
  - `play`: only capabilities Play allows (to be verified, see below). Candidates are FCM push, a share target, calendar read, contacts read and possibly the notification listener.
  - `full`: adds SMS capture and anything else Play restricts. Distributed from the owner's own site, with its own update feed.
- **Upgrade path:** a "get more" link from the Play build to a web page with a download button and QR code. No in-app install, which Play forbids. The first-run screen of the full build walks the user through the restricted-settings and notification-access steps with screenshots, because that is where most users will drop off.
- **Security:** load only the dashboard origin, open every other host in the system browser, validate bridge arguments natively. On-device filters (OTPs, 2FA, bank codes, sender allowlists) default to on.
- **iOS:** no SMS access exists. iPhone users get the PWA and the connectors that need no app.

## 6. Messaging policy (proposed change to `architecture-rules.md`)

Today `contacts` is an email sender directory and no messaging platform is ingested (owner's decision, 2026-09-10). A shared contact directory across channels weakens the "keep the table small" rationale, and full SMS forwarding is a deliberate step past the rule. Proposed replacement, to be written into `docs/architecture-rules.md` only after the owner confirms:

- **Items yes, contacts no by default.** Messages from any enabled channel are indexed. The framework links a message to an existing contact by address or number match and never creates a contact from messaging automatically.
- **Opt-in per source,** each with its own credential filter at the fetch choke point and its own drop log, as the current rule already requires for any new personal source. The failure of each source must reach the dashboard.
- **Sources, in order:**

| Source | Plan |
|---|---|
| SMS, full forwarding | First. Full flavor only. Filter OTPs, 2FA and bank codes on the device and again in the framework. SMS already reaches `raw_items`, so this extends something that exists. Run it for a few weeks before anything else |
| Slack | Second, through the official OAuth connector, never notification scraping. Check workplace policy first, it is the employer's data |
| WhatsApp, Signal, Telegram | Last, and only through notifications, since there is no official API. Decide after the SMS data shows whether it is worth it |

- **Customers:** none of this is offered to customers by default, which matches decision A12 in `MULTI_USER_PLAN.md`. Capturing other people's messages for paying users needs the legal review that plan already requires.

## 7. Phases

### Phase 0: audit and decisions
- [ ] Audit the extraction schema and tag every field neutral or interpretation (section 4.1).
- [ ] Read `docs/context-builder.md`, `context-builder/README.md` and the `contacts` schema, and list every consumer of `contacts` and of the context document.
- [ ] Decide F4 (notes) and the contact overlay shape.
- [ ] Verify the items in "Not verified", above all Play policy, WebView push and offline behavior.
- [ ] Settle open questions 1 to 4.

Gate: a written boundary table that names every table and module on one side or the other.

### Phase 1: internal module boundary
- [ ] Create `framework/` and move ingest, raw item storage, drop logs and failure records behind its API.
- [ ] Add the boundary check script and wire it into `bun run check`.
- [ ] PIDRA output stays identical on a restored production dump (diff the `daily_reports` row).

### Phase 2: neutral classification in shadow
- [ ] Framework neutral pass, app second-pass API, shadow comparison for one to two weeks.
- [ ] Measure model calls and cost per item against today.

Gate: gate outcomes match, cost is acceptable.

### Phase 3: contacts, context document and corrections
- [ ] Move identity and the Context Builder into the framework with the versioned document contract and the correction layer unchanged.
- [ ] Add the per-app triage overlay.

### Phase 4: SMS app, owner only
- [ ] WebView shell with the bridge, SMS capture, WorkManager queue, on-device filter, battery-optimization exemption.
- [ ] The dashboard `PidraNative` settings section and a "last SMS received" health indicator.
- [ ] Per-user token instead of the shared `SMS_WEBHOOK_SECRET`, in line with the multi-user plan.

### Phase 5: Play flavor
- [ ] Compile out restricted capabilities, add FCM push and the share target, run a closed track.
- [ ] Add the notification listener to `play` only if the closed track passes review.

### Phase 6: extraction to a service
- [ ] Only when a second app exists and the API has been used in anger. Fold in tenancy from the multi-user plan.

## 8. Risks

- **Premature abstraction:** one real consumer. Mitigation: the internal boundary first, with a check script, and no service until app two.
- **Information loss in neutral extraction:** mitigated by raw items in the framework and the second-pass API.
- **Two notes systems:** decide F4 in Phase 0.
- **Shared context contract:** one app's change breaks another. Mitigation: versioned contract and a consumer check.
- **Privacy:** the framework becomes the single place holding every source. The credential filter, per-source opt-in and drop logs must exist before any source is added.
- **Play review:** the Play flavor can be rejected or removed over sensitive permissions. Keep it fully useful without them.
- **Play Protect:** the full flavor will probably be flagged on install, which hurts conversion and trust.
- **Scope:** this plus the multi-user plan is a large amount of work. Sequence them deliberately (section 4.5).

## 9. Open questions

1. Name of the framework and whether it stays in this repo long term.
2. Whether the full flavor should share an `applicationId` and signing key with the Play flavor, or use separate IDs. A Play-signed and a self-signed build cannot replace each other, so separate IDs are the safe default.
3. Whether the framework's calendar, notes and tasks are the system of record or a cache of Google's. This decides sync conflict handling.
4. Which Phase 4 capabilities beyond SMS the owner wants in the first release.
5. Update channel for the full flavor: a self-hosted feed the app checks itself, or Obtainium or an F-Droid-style repo.

## 10. Not verified

- Google Play's current policy text on SMS, notification listener, call log, in-app download links and WebView wrapper apps. Everything said about what Play allows comes from memory.
- Whether web push works inside a plain Android WebView, and whether the service worker and offline mirror behave the same there as in a browser. Test cold start offline in the real WebView.
- Android's restricted-settings behavior for sideloaded apps on current versions.
- Whether the F-Droid SMS forwarder supports a custom `X-SMS-Secret` header. The search results only showed default headers.
- Everything about the current extraction schema, `contacts` columns and the Context Builder internals. This plan names them from `CLAUDE.md` and `docs/architecture-rules.md` only.
