# REFACTOR_PLAN - code health pass

Status: proposed, not started. Delete this file when the last phase lands (open leftovers move to `docs/todo/`).

Source: six parallel read-only audits (backend core, pipeline, dashboard routes, dashboard lib, context-builder/CSS/tooling, cross-cutting dead code and duplication). Every line delta below is an estimate from reading the code, not a measurement. Re-measure with `git diff --shortstat` per phase.

## Goal and targets

- Net reduction of roughly **3,500 to 4,500 lines** out of ~41k (about 9-11%), plus a comment diet of ~300 more. Optional deletions (section "Owner decisions") add 700 to 1,300.
- Same design, same behavior, better performance (fewer DB round trips, no full-report IndexedDB reads, no per-tick recomputation).
- No file over **~350 lines** for `.ts`, **~250 lines** for `.svelte` (enforced by a new check step, see Phase 9). Current offenders: `blackhole/run.ts` 826, `schema.ts` 744, `[date]/+page.svelte` 651, `server/index.ts` 630, `propose.ts` 587, `context-builder/+page.svelte` 543, `service-worker.ts` 512, `context-builder/run.ts` 504, `news/run.ts` 459, `questions/store.ts` 444, `notes/+page.svelte` 440, `notes/store.ts` 401, `routes.ts` 401.
- Svelte 5 idioms: derived instead of effect-synced state, attachments/actions instead of effects that touch the DOM, `SvelteSet` instead of copy-on-write sets, `$derived` fields instead of recomputing getters.

Current line counts per area (`src` 13.7k, `dashboard/src` 22.9k, `dashboard/scripts` 2.0k, `context-builder` 2.6k) and the full-check result as the reference.

## Ground rules

- Obey the commit workflow in `CLAUDE.md`: small thematic commits through the `commit` skill, full `bun run check` before each (`check:quick` while iterating). Do not hand-edit `docs/**`; pass the reasoning to `/commit` so `docs-committer` writes it.
- One phase = one or more commits, never a mixed commit. Each step below is independently committable unless a dependency is listed.
- Behavior-neutral steps first. Anything that changes behavior is tagged **[BEHAVIOR]** and gets its own commit with the reason in the message.
- The blackhole suite (`dashboard/scripts/blackhole/run.ts`) and `tests/` are the safety net. Run the full check after every UI primitive swap (Phase 5) and every offline-layer change (Phase 8). Test UI changes in a browser; code tags must never overflow their container (see memory: raised 6x).
- Concurrent sessions can share this working dir: re-verify `git status` and stage only files touched by this plan.
- Risk tags: L low, M medium, H high.

---

## Phase 1 - Shared primitives (everything else depends on these)

Creating these first turns later phases into mechanical find-and-replace.

**Status: done 2026-10-04, with these deviations.** 1.3b is void (the backend is UTC everywhere, `utcDay()` is the day key; `daysAgo`, `DAY_MS` added). 1.6 lives in `util/retry.ts`, not `ai/retry.ts`. 1.7 stopped exporting the client; `usageTally` replaced the hand-rolled counters but the `onUsage`/`onAiCall`/`onCall` threading in `news/research.ts` waits for 3.11. 1.10 covers `context-builder/config.ts` only (`src/ai/models.ts`); `dashboard/lib/pricing.ts` keeps its own constant because the client cannot read `process.env`. 1.12 turned out to need no helper: the driver already takes `sql()<Row[]>`, so the casts moved to the query. `iso()` and `median()` had one copy each, left alone. 1.13 is `readForm` (text/flag), 1.14 is `authManagerDenied`/`setAuthCookie`/`readJson`. 1.16 is `jsonInit` and `statusOf`; `errorFrom` was skipped (the call sites differ in what they fall back to). 1.17 is `toneFor` plus `scoreTone` and `isTyping` (`clock` had one copy). 1.18 landed `Paged`/`<ShowMore>` and `offline.isOffline`; `urlFilter`, `enhanceWith`, `useFormToast` and `pageContext` were skipped as wrappers that save a line or two each without removing real duplication.

### Backend (`src/util/`)

| ID | Change | Delta | Risk |
|---|---|---|---|
| 1.1 | `util/text.ts`: `errMessage(e)` replaces `e instanceof Error ? e.message : String(e)` (49 sites in 34 files). Dashboard re-exports it via `$lib`. Local `message()` helpers in `news/run.ts:74`, `phase1-ingest.ts:26`, `pipeline/run.ts:48` go away | -50 | L |
| 1.2 | `util/text.ts`: `squash(text, max)` replaces `replace(/\s+/g," ").trim().slice(0,n)` in `phase2-extract.ts:108,112`, `phase4-questiongate.ts:53`, `research.ts:88`, `propose.ts:345`, `reconcile.ts:127`, `process-answer.ts:19-20` | -25 | L |
| 1.3 | `util/time.ts`: add `DAY_MS`, `todayKey()`, `daysAgoKey(n)`; replace the ~34 `toISOString().split("T")[0]` and ~22 `86400_000`. Delete local `daysBefore` (`news/run.ts:76`, `topic-lifecycle.ts:44`), `berlinDay` (`search/brave.ts:10`), Berlin formatting in `ai/chat/context.ts:92,97` | -80 | L (see **[BEHAVIOR]** 1.3b) |
| 1.3b | **[BEHAVIOR]** Define `todayKey()` in Europe/Berlin (the cron schedule, Brave quota and `HOME_TIME_ZONE` already are). Today the UTC day is used in most places, so between 00:00 and 02:00 Berlin "today" is yesterday. Verify against the cron times in `docs/operations.md` before switching each call site. Separate commit | 0 | M |
| 1.4 | `util/ids.ts`: `UUID_RE`, `DATE_RE`, `isUuid`, `isIsoDate`. Replaces 10 copies in `server/index.ts`, `notes/store.ts:63`, `skills/revert_context_revision.ts:15`; dashboard already has `#lib/ids` (extend it with the date regex, 10 copies in routes) | -30 | L |
| 1.5 | `util/errors.ts`: `class HttpError extends Error { status }`. `QuestionError`, `ActionError`, `NoteError`, `CorrectionError`, `AudioError`, `SkillToggleError` extend it. Enables Phase 3.1 | -10 | L |
| 1.6 | `ai/retry.ts`: one `retry({attempts, delay, shouldRetry})` behind `withRetry`, `withFlexRetry` (keep the 429 semantics) and the Brave backoff loop. `tolerant(step, fn, fallback, errors)` for the 5 identical try/catch-and-record shapes (`pipeline/run.ts:24-36,44-52,109-113`, `phase4-questiongate.ts:99-107,125-135`) | -65 | M |
| 1.7 | `ai/openai.ts`: `callModel()` for the shared create/record/usage plumbing, one `CallOptions`, `usageTally()` for the `tokensIn/tokensOut/onUsage` boilerplate in `propose.ts:525`, `reconcile.ts:942`, `news/research.ts`. Stop exporting the `openai` client (enforces the one-client rule) | -45 | L |
| 1.8 | Export one `parseJsonRows` (from `phase3-context.ts:87`) and reuse in `actions/propose.ts:215`, `news/run.ts:194`, `scripts/actions-dry-run.ts` | -20 | L |
| 1.9 | `ingest/google-client.ts`: single `googleAuth()` (duplicate in `implicit-feedback.ts:5` and `ingest/google.ts:25`); `senderAddress(from)` exported from `ingest/sources.ts` (duplicate in `ingest/imap.ts:73`) | -15 | L |
| 1.10 | `context-builder/config.ts` imports `EXTRACTION_MODEL`/`SYNTHESIS_MODEL` from `src/ai/openai.ts` instead of repeating `gpt-6-luna`; same for `dashboard/lib/pricing.ts` | -4 | L |

### Dashboard (`dashboard/src/lib/`)

| ID | Change | Delta | Risk |
|---|---|---|---|
| 1.11 | `$lib/server/bridge.ts`: single `API` constant, `bridgeFetch`, `bridgeProxy` (for `+server.ts`, returns 502 with one consistent message), `bridgeAction` (for form actions, returns `fail`). Replaces 17 files that each redeclare `SKILLS_BRIDGE_URL ?? "http://localhost:4000"` (21 hits), two config sources (`process.env` vs `$app/env/private`), and 3 different "unreachable" wordings. Keep the audio proxy's header allow-list as an option | -170 | L |
| 1.12 | `$lib/server/postgres.ts`: typed `sql<T>()` helper. Removes 12 `as unknown as Row[]` casts (`search.ts`, `triage.ts`, `sources/+page.server.ts`, `sources/[name]/+page.server.ts`, `extractions.ts`, `contextBuilder.ts`) and most hand-rolled row interfaces. `iso()` (copied in 4 files) and `median()` move to `$lib/format.ts` | -60 | L |
| 1.13 | `$lib/server/form.ts`: `readForm(request, {id: "uuid", status: [...]})` for the ~14 repeated `formData → trim → fail(400)` blocks | -50 | L |
| 1.14 | `$lib/server/auth.ts`: `requireAuthManager(event)`, `readJson<T>(request)`, `setAuthCookie(...)` (cookie options repeated 4 times, 6 routes repeat the 401 guard) | -40 | L |
| 1.15 | `$lib/storage.ts`: one try/catch localStorage wrapper replacing `assistant/state.svelte.ts:49-64`, `theme.svelte.ts:42-63`, `entry-hint.svelte.ts`, `context-builder/+page.svelte:271-286` | -30 | L |
| 1.16 | `$lib/net/` helpers: `errorFrom(res)` (JSON-error parse repeated in `assistant/state:219-227`, `player:241-243`, `netJson`, `intents:195-198`), `jsonInit(method, body)` (22 sites), `statusOf(kind)` (`hooks.client.ts:23` vs `net.ts:251`) | -40 | L |
| 1.17 | `$lib/labels.ts`: `toneFor(kind, value)` replacing `STATUS_TONE` redefined in 7 pages; `scoreTone` once in `$lib/format.ts` (2 copies). `clock()` from `ReportPlayer` into `format.ts`; `isTyping` into `ui/keys.ts` (2 copies) | -55 | L |
| 1.18 | `$lib/ui/` rune helpers: `paged(list, size)` + `<ShowMore>` (4 copies), `urlFilter({path, defaults, parse})` (copied between `entities` and `notes`, a third variant in `topics`), `enhanceWith({busy, onSuccess, sync})` (8 hand-written `use:enhance`), `useFormToast(() => form)` (12 pages), `pageContext(() => ({...}))` (17 pages with `$effect(() => setPageContext(...))`), `offline.isOffline` getter + `<OfflineHint>` (22 sites derive `reachable === "offline"`) | -260 | L-M |

Phase 1 total: about **-1,000 lines**, almost all mechanical.

---

## Phase 2 - Dead code and deletions

Verified by `rg -w` over the repo including `skills/`, `docs/`, `scripts/`. `skills/*.ts` at the repo root imports from `src/`, so most "unused" exports are live; only the following are truly dead.

| ID | Change | Delta | Risk |
|---|---|---|---|
| 2.1 | Delete `getSelfEmails` (`ingest/sources.ts:12`), `isCurrent` (`routes.ts:296`, or make Navbar use it), `loadCheckpoint` (`context-builder/checkpoint.ts:23`, check caller), `PROMPT_VARIABLES` (`prompt-vars.ts:21`), `components/Skeleton.svelte`, unused types `Segment`, `RunStatus`, `QuestionView`, `surfaceForRoute` pass-through, `intentTarget`, `classifyFailure`, `checkBootstrap`, `readContextDocument` if confirmed unreferenced | -70 | L |
| 2.2 | Drop `export` on symbols used only in their own file: `headlineTokens`, `DeskPlan`, `MIN/MAX_WINDOW_HOURS`, `EditorStory`, `ResearchAnswer`, `DeskReport`, `RunOptions`, `RssIngestResult`, `IngestResult`, `GateResult`, `TopicImportance`, `computeWeeklyAnalytics`, `generatePromptDiff`, `runSlot1-3`, ~35 dashboard types, `REPORT_JSON_VERSION`, `COST_MODEL`, `PRICE_*`, `MAX_FOCUS_*`. Cosmetic, 0 lines, shrinks the API surface | 0 | L |
| 2.3 | `ai/chat/index.ts`: remove re-exports nothing imports (`MAX_*`, `buildHistory`, `skillTools`, `SKILL_TOUCHES`, `normaliseContext`, `systemPrompt`, `correctionsSummary`) | -15 | L |
| 2.4 | `db/relations.ts` (47 lines) plus the schema arg in `db/index.ts:9`: only `phase3-context.ts:137` uses `db.query.extractions.findMany({with})`. Replace with a join, delete the file | -45 | L |
| 2.5 | Stale `/prompts` references after commit `2ff7463`: `ai/surfaces.ts:29,205-217,285` still say "only the user can activate it on this page"; `dashboard/lib/assistant/pageContext.ts:15`; comments in `propose.ts:7`, `active-prompts.ts:7,44`, `prompt-vars.ts:20`, `news/config.ts:22`. Fold `propose_prompt_version` into `global` or fix its text **[BEHAVIOR: assistant prompt text]** | -20 | L |
| 2.6 | `@types/diff` unused (diff v9 ships types); `tsconfig` in `context-builder/` only adds `$db`, delete if unused | -10 | L |
| 2.7 | Unused CSS: `nav-btn-disabled` (`app.css:364`), `--app-panel-raised`, `--app-border-soft` plus their light-mode mirrors | -8 | L |
| 2.8 | Delete `blocksUntil` column (`schema.ts:457`), needs a migration | -2 | M |
| 2.9 | `scripts/` tidy: `dashboard/scripts/source-links.test.ts` moves into `tests/` and its check step goes; merge the two Keep `.py` scripts' duplicated `load_env` (pass env from `keep.ts` spawn) | -30 | L |

Phase 2 total: about **-230 lines**.

**Status: done 2026-10-04, with these deviations.** 2.1: `intentTarget`, `checkBootstrap`, `readContextDocument` and `classifyFailure` turned out to be used inside their own files (`classifyFailure` also by a test), so they only lost or kept their `export`; deleted were `isCurrent`, `Segment`, `RunStatus`, `QuestionView`, the `surfaceForRoute` pass-through, `loadCheckpoint`, `getSelfEmails` with the `SELF_EMAILS` env var, `PROMPT_VARIABLES` and `Skeleton.svelte` (the last four after asking the owner). 2.2: 28 symbols unexported; 32 types stay exported because they appear in the signature of an exported function or type. A scan of the whole repo found about 60 more own-file-only exports (mostly option and result types) that were left alone, as was `src/ai/jev.ts` (future API). 2.3: only the unimported value re-exports went; the type re-exports and `persistAssistantTurn` stay. 2.4 skipped by the owner (`db/relations.ts` stays). 2.5: only the stale `/prompts` comments were reworded; the assistant `prompts` surface text, its route mapping and `propose_prompt_version` are untouched, pending an owner decision on where prompt approval lives now that the page is gone. 2.6: `@types/diff` and `context-builder/tsconfig.json` removed. 2.7: `nav-btn-disabled` and the two tokens removed, there were no light-mode mirrors. 2.8: `blocks_until` dropped via `migrations/0042_drop_questions_blocks_until.sql`, which the owner applies by hand before deploying. 2.9: `source-links.test.ts` moved to `dashboard/tests/` and its check step removed; `load_env` removed from `keep-fetch.py` only (the spawn passes `process.env`, and the pronix unit loads `.env`), `keep-auth.py` keeps its own because it runs by hand.

---

## Phase 3 - Backend modularization

Order matters inside this phase; items touching the same file are grouped.

| ID | Change | Delta | Risk | Depends |
|---|---|---|---|---|
| 3.1 | **`server/index.ts` 630 to ~50.** Split into `server/routes/{skills,questions,prompts,notes,actions,chat,context,audio,sms}.ts` mounted with `app.route()`. One `app.onError` mapping `HttpError` (deletes ~12 try/catch blocks at `index.ts:35-44,115-120,137-141,261-290,385-453,473-479,589-615` and `noteError` at 363; replaces the `message.includes("not found")` status guess at 365). `uuidParam` middleware and `bodyOf<T>(c)` for the repeated `c.req.json().catch(() => ({}))` | -180 | L | 1.4, 1.5 |
| 3.2 | Move logic out of handlers: `/api/deepen` to `ai/deepen.ts`, SMS webhook body to `ingest/sms.ts`, prompt-version insert/approve to `ai/prompt-store.ts` (wrap approve's deactivate+activate in `db.transaction`, see bug B3) | 0 | L | 3.1 |
| 3.3 | **`db/schema.ts` 744 to ~7 files of ~100** under `db/schema/{pipeline,context,notes,questions,chat,auth,config}.ts` with an `index.ts` re-export (drizzle config and `export * from "./schema"` keep working). `pk()` and `createdAt()` column helpers replace 29 and 22 repeated lines. Replace inline `import("../pipeline/gate").GateDetail` with top-level `import type`. Move ~230 comment lines to `docs/schema-notes.md` (via docs-committer), keep one line per table | -50 | L | |
| 3.4 | **`actions/propose.ts` 587 to ~140 core** under `actions/propose/{types,matching,check,index}.ts`. `EventPreview` type deduplicates `add_event`/`update_event`; `strictObject(props)` for the JSON schemas (the `required` list is always every key); extract `buildPayload` and `applyCaps` from the 100-line `proposeQuickActions`; keep `sameThing` exported for `actions/store.ts` | -25 | L | 1.2, 1.7 |
| 3.5 | **`questions/store.ts` 444.** `applyPlan` and `QueuePlan` to `questions/apply-plan.ts`; `teachContact` and its schema to `questions/teach-contact.ts`. One `transitionQuestion(id, from, patch, event, reason)` for `answerQuestion`/`dismissQuestion`/`reopenQuestion`, also reused by `actions/store.ts:117 transition()`. Local `whenOpen(id)` | -35 | M | |
| 3.6 | **`notes/store.ts` 401.** `mutateNote(id, op, actor, build)` for the repeated begin-tx / load / not-found / insert revision / update in `updateNote`, `softDeleteNote`, `restoreNote`; `assertOneOf`/`assertDate` for `listNotes` validation; plain `sql` instead of `drizzleSql` | -55 | L | 1.4 |
| 3.7 | **`skills/execute.ts`.** Local `settle(id, status, result?)` replaces 11 near-identical `db.update(skillExecutions)` calls (lines 523-640); extract `gate(skill, effective)` and `runSkill(...)` shared by `executeSkill` and `resolvePendingSkill`. Keep the audit-row-before-gate ordering (intentional) | -55 | L | |
| 3.8 | `skills/loader.ts`: 30 imports plus a second 30-name array. Auto-discover with `Bun.Glob("skills/*.ts")` (-55). Only if `scripts/check-route-surfaces.ts` still works, otherwise a single table | -55 | M | |
| 3.9 | `skills/overrides.ts:881` `EffectiveSkill` becomes `Omit<Skill,"execute"> & {...}`; `push.ts` stale-subscription delete batched with `inArray` | -15 | L | |
| 3.10 | **`news/run.ts` 459 to ~250.** `loadReusedDesks()` (lines 323-380) and `buildCandidates()` (383-422) to a new `news/store.ts`; a `Usage` class with `add()` replaces the four duplicated token accumulations (388-403); `storyFromStored` and `toExtraction` sit together in `validate.ts` | -50 | M | 1.1, 1.3, 1.6 |
| 3.11 | `news/research.ts`: one `Usage` object instead of `onUsage`/`onAiCall`/`onCall` threaded through 4 functions with 9 positional args; the 40-line prompt literals in `planQueries` and `finalPrompt` move to named constants in `ai/prompts/news-desks.ts` | -25 | L | 3.10 |
| 3.12 | `news/validate.ts` 370 split into `validate/{url,duplicates,checks}.ts` (shares the stopword list with `implicit-feedback.ts:28`); `news/format.ts` 334: one `parseGroups(markdown)` feeds both `foldSingleStoryGroups` and `enforceNewsCaps` | -30 | M | |
| 3.13 | **`context/corrections.ts` 324.** Table-driven `ROW_KINDS = {contact, entity}` for `mergeStructuredRow` and `revertCorrection` (lines 282-315); shared `insertCorrection()`. Add a revert test first | -60 | M | |
| 3.14 | **`ingest/google.ts` 316.** Skill parameter parsing (`intParam`, `boolParam`, `emailList`, `sendUpdatesParam`, `reminderOverrides`, `eventTime`, `assertExpectedTitle`, ~90 lines) moves to `skills/params.ts`; `upsertSnapshot()` for the duplicated calendar/tasks upsert; clients no longer `async` | -35 | L | 1.9 |
| 3.15 | **`pipeline/phase3-context.ts` 310.** Split into `gate-items.ts`, `entity-context.ts`, `todos.ts`. Type `todaysExtractions` to remove 7 `as any` (lines 170,176,188,190,191,248,295). `phase6/system-block.ts` 7 `any`s: define a `TopicUpdate` type. `ExtractedJson` via drizzle `.$type<>()` | -20 | L | |
| 3.16 | `ai/chat/stream.ts`: extract `openConversation()` and `runToolCall()` from the ~100-line `streamMessage`; German fallback text at line 369 becomes English | -10 | L | |
| 3.17 | `context-builder/run.ts` 504: split the 415-line `runContextBuilder` into `phases/{fetch,extract,synthesize,finalize}.ts` with a `RunCtx`; `safePhase(name, state, fn)` collapses the four fetch try/catch blocks. Verify resume, dry-run and `--from-index` manually (documented in `docs/context-builder.md`) | -70 | M | |
| 3.18 | `scripts/deploy.ts` 279: `ok(bool)`, `section()`, `verifyService()` replace the 3x ✓/✗ pattern and overlapping failure blocks | -25 | L | |
| 3.19 | `implicit-feedback.ts`: one loop over `[calTexts,5],[todoTexts,4]` for the two copy-pasted insert blocks (116-129) | -8 | L | |

Phase 3 total: about **-800 lines**, and every file in `src/` below ~350 lines.

**Status: done 2026-10-04, with these deviations.** Splitting added imports and headers, so the net is about +180 lines across the phase (the gain is file size and structure, not line count); `src/notes/store.ts` is 367 lines, the only `src/` file over ~350. 3.1/3.2: `server/routes/{skills,audio,sms,pipeline,questions,prompts,actions,notes,chat,context}.ts`, `server/http.ts` (`bodyOf`, `uuidParam`, `onError`), `ai/deepen.ts`, `ingest/sms.ts`, `ai/prompt-store.ts`; `revertCorrection` now throws `CorrectionError` with 409 so the revert route keeps its status. 3.3: `db/schema/` verified identical to the old schema table by table (0 diffs, no migration). 3.4: `actions/propose/{types,matching,check,mails,index}.ts`. 3.5: `questions/{apply-plan,events,teach-contact}.ts` plus `transitionQuestion`; the `actions/store.ts` `transition()` was left alone (different table, already small). 3.6: `mutateNote`, `assertOneOf`, `assertDate`. 3.7: `settle`, `reject`, `runSkill` (the line numbers in the plan were stale). **3.8 skipped**: the loader must stay synchronous (`getSkill` is called everywhere) and skills import `provenanceOf` from the loader, so a top-level-await auto-discovery would deadlock on that cycle. 3.9: `EffectiveSkill` via `Pick`, one batched stale-subscription delete. 3.10/3.11: `news/store.ts`, a `Usage` class in `news/research.ts`, prompt text in `ai/prompts/news-desks.ts`. 3.12: `news/validate/` as a directory; the stopword list was NOT shared with `implicit-feedback.ts` (different lists for different jobs, sharing would change behavior). 3.13: `ROW_KINDS` table, `insertCorrection`, new `tests/corrections.test.ts` written against the old code first; the file did not shrink (334 lines). 3.14: `skills/params.ts`, `upsertSnapshot`, synchronous Google clients. 3.15: `gate-items.ts`, `entity-context.ts`, `todos.ts`; today's extractions are a join select, `extracted_json` is typed (`ExtractedJson`), `system-block.ts` has real types; `db/relations.ts` is now unused by the pipeline but stays (owner kept it). 3.16: the German fallback text was already gone. 3.17: `context-builder/phases/*` with `safePhase`; verified with `context-builder:dry` only, resume, `--from-index` and a real run still want one manual pass. 3.18: one `report()` helper. 3.19 and the Phase 4 items 4.5 and 4.7 (concurrent calendar/tasks fetch, map instead of nested `find` in the gate scoring) landed along the way.

---

## Phase 4 - Backend performance

All independent, each a small commit. Low risk unless noted.

| ID | Change | Gain |
|---|---|---|
| 4.1 | `weekly-meta-run.ts:27-100`: 7 independent queries run sequentially, use `Promise.all` plus a `countWhere()` helper | -15 lines, latency |
| 4.2 | `weekly-source-scoring.ts`: N+1 on `sourceDailyScores`; one grouped query, aggregate in memory, batch updates | -10 lines, N queries to 1 |
| 4.3 | `askedExtractionIds()` called 3x per run (`phase4-questiongate.ts:71`, `entity-questions.ts:41`, `stale-context-questions.ts:61`): fetch once in `openQuestions` and pass down | 2 queries/run |
| 4.4 | `loadLongTermContext()` runs twice per pipeline run (`news/run.ts:338`, `phase3-context.ts:268`): load once in `executePipeline`, pass down | 2 queries/run |
| 4.5 | `implicit-feedback.ts:70-105`: calendar and tasks fetched sequentially, `Promise.all` | latency |
| 4.6 | `ingest/rss.ts` and `ingest/imap.ts`: `rawItemExists(id)` per item then single-row insert. Prefetch `inArray(messageId, ids)` per feed/account, bulk insert with `onConflictDoNothing`, parse mails in batches of 8 | hundreds fewer round trips per morning (M) |
| 4.7 | `phase3-context.ts:194-196` nested `find` (O(n^2)) to a `Map`; `activeTopics` queried twice (124, 146), one query | -5 lines |
| 4.8 | `persistGate` (`phase3-context.ts:103`) row-by-row UPDATE: group by identical verdict with `inArray` or one `UPDATE ... FROM (VALUES ...)` (M); `phase6/contacts.ts:15` same | many fewer queries |
| 4.9 | `audio/store.ts:531` speaks chunks sequentially; `Promise.all` capped at 3 (first-play latency); `variant()` is a function over constants, make it a const | latency |
| 4.10 | `search/slots.ts:203-228` computes `new Date()` twice; slot 3 day-of-year uses server-local time, use `localDay` | correctness |
| 4.11 | Dashboard `server/triage.ts:336-352` runs `items.filter` nine times, one pass; `server/search.ts:62-167` four queries plus four mappers become one `{sql, map}` table (-50); `auth.ts` shared credential/session column fragments and one TTL-map helper (-30); `contextBuilder.ts` split into `harvest.ts` and `run.ts` | -90 lines |
| 4.12 | `chat/+page.server.ts` three sequential queries to `Promise.all`; `questions/+page.server.ts` dead `open` to `openViews` indirection; `sources` list/detail duplicate `thirtyDaysAgo` and `DailyScore` (two shapes) share one `SourceQualityRow` + `mapRow` (-35); `runs` and `runs/[id]` share one `mapRun` (-35) | -70 lines |

**Status: done 2026-10-04, with these deviations.** 4.1: `countWhere()` plus one `Promise.all` over the seven queries. 4.2: one `source_daily_scores` query for all sources, grouped in memory, updates run concurrently. 4.3: `askedExtractionIds()` is read once in `openQuestions` and passed to the three candidate builders. 4.4: `shareLongTermContext()` is a lazy memoizing loader (a failed load is not cached, so Phase 3's retry still reloads) passed to `runNewsDesk` and `runPhase3`. 4.5 landed with Phase 3. 4.6: `existingMessageIds()` replaces `rawItemExists` in RSS and IMAP, inserts are bulk with `onConflictDoNothing` on `message_id`, IMAP parses in batches of 8 and writes its drops once per batch (a cross-feed or cross-account duplicate is now skipped instead of throwing on the unique key). 4.7: the nested `find` landed with Phase 3; the two `active_topics` queries are now one. 4.8: `persistGate` and `incrementContactEmailCounts` use `UPDATE ... FROM (VALUES ...)` (checked against the real database inside a rolled-back transaction). 4.9: waves of 3 concurrent speech requests, `VARIANT` is a constant. 4.10: slots 2 and 3 derive month and rotation from `runDate` (the backend is UTC everywhere, so the "server-local time" bug no longer existed). 4.11: triage counts in one pass, `search.ts` is a `SOURCES` table, `auth.ts` has shared column fragments and an `ExpiringMap` for the three nonce stores, `contextBuilder.ts` split into `contextHarvest.ts` (document) and itself (run control). 4.12: chat loader parallel, `questions` indirection gone, `lib/server/sourceScores.ts` (one daily-scores query, so `/sources/[name]` now gets `runDate` as text like the list does) and `lib/server/runs.ts` (`runColumns`/`mapRun`); the `SourceQualityRow` merge was skipped because the list and detail select different columns.

---

## Phase 5 - Dashboard UI primitives

Highest visual risk. After each step run `contrast.ts`, the full blackhole suite and a manual browser pass (dark and light, phone width).

| ID | Change | Delta | Risk |
|---|---|---|---|
| 5.1 | **Button utilities.** `@utility btn`, `btn-primary`, `btn-ghost`, `btn-danger`, `btn-sm`, `chip` in `app.css` (only `nav-btn` and `input-base` exist; 158 `<button>`s and 153 `cursor-pointer`s carry long inline class strings, `border-primary-700 bg-primary-900 ... hover:bg-primary-800` is copied at 9+ sites). Optional `Button.svelte` wrapper with `variant`, `size`, `busy` (renders `Spinner`) | -250 | M |
| 5.2 | `<Card tone as>`: the `rounded-lg border border-surface-700 bg-surface-900 px-4 py-3` shell is pasted ~25 times (`StatCard`, topics, runs, skills, contacts) | -50 | L |
| 5.3 | `<Field name label hint mono>` replaces 12 label+input blocks in `settings/email-accounts` and the same pattern in `contacts`, `newsletters`, `rules`, `setup`, `login`; newsletters' hand-rolled modal (lines 705-748, own Escape handler) moves to the existing `Sheet` | -110 | L |
| 5.4 | `<Tabs>`/`<Segmented>`: the `role=tab` markup appears in `context-builder`, `chat` (mobile segmented control) and `TabBar` | -30 | L |
| 5.5 | Tables: `Column.text`/`Column.badge` helpers (or `Column.value: (row) => string` plus `class`) replace 6-7 one-line `{#snippet ...Cell}` per page (`entities`, `sources/[name]`); one `<UsageTable rows columns>` replaces both tables in `runs/[id]` | -80 | L |
| 5.6 | Icons: use `@lucide/svelte` where hand-rolled `<svg>` exists (`Panel` 5, `ConversationList` 3, `ConfirmButton:97`, `QuickActions`, `ToolChip`, `CommandPalette:170`, `Navbar`). `ToolChip:46-58` re-declares six path constants identical to `routes.ts ICON`, and its two 30-entry maps (`LABELS`, `ICON_PATHS`, same keys) merge into one `SKILLS: {label, icon}` table. `Panel:27 ASSISTANT_MARK` equals `ICON.chat` | -90 | L |
| 5.7 | `NavLink.svelte` (or `linkState(entry)`): the badge/unavailable/aria-current/preload logic is copied four times (`Navbar:143-168,195-219`, `TabBar:69-96,105-122`). Also remove the `GROUPS = NAV_GROUPS` alias, the duplicated settings icon path (`Navbar:237` vs `routes.ts:79`), move the update-banner SVG shoulders (`Navbar:112-137`) to `UpdateBanner.svelte` | -70 | L |
| 5.8 | `use:dismissable` action: 13 hand-written Escape handlers, five dropdowns with a full-screen scrim button (`Navbar:186-193`, `DayNav:79`, `SectionNav:130-137`, `NotesToolbar:44-49`, `SyncSheet:24-31`). Focus/a11y behavior must be preserved; the blackhole lanes may click scrims | -80 | M |
| 5.9 | Small shared pieces: `<JsonBlock>` (same `<pre>{JSON.stringify(parameters)}</pre>` in `skills` and `skills/executions`), `<ExpandRow>`/`<Disclosure>` (`skills/executions`, `runs`), `<TraceBar>`, `<Legend>`, `<CostShareBar>` for `runs/[id]`, `LegalPage` wrapper for `privacy`/`terms`/`+error`, `Switch` takes `name`/`onchange` so the hidden-checkbox + `requestSubmit` pattern disappears | -90 | L |
| 5.10 | Fix the German error `"Unbekannte Quelle"` in `sources/[name]/+page.server.ts` and any other German strings in the English UI | 0 | L |

Phase 5 total: about **-850 lines**.

**Status: done 2026-10-04, with these deviations.** The net is small (about -350 lines of source; the gain is shorter class strings and one place per primitive). 5.1: `btn` plus separate size (`btn-sm/md/lg`) and tone (`btn-primary/solid/ghost/danger`) utilities, `chip` with `chip-on/off`, `nav-btn` carries its disabled styling, and one base rule gives `button:not(:disabled)`, `summary` and `[role=tab]` the pointer cursor, so the per-element `cursor-pointer` is gone; no `Button.svelte` wrapper (utilities were enough). Near-identical variants were normalised (primary border 700, py-1.5, rounded), so a few buttons moved by a pixel or a hover colour. 5.2: `Card.svelte` with tones default, inset, warning and error; skipped for `<p>`, `<form>`, `<details>`, `/30` and `/40` tinted boxes and dropdown panels. 5.3: `Field.svelte`; the newsletters edit modal now runs on `Sheet`; the login PIN, the questions textarea and the settings selects were left alone. 5.4: `Tabs.svelte` (context-builder) and a separate `Segmented.svelte` (chat, which was never `role=tab`); `TabBar` is nav and stayed with 5.7. 5.5: columns take `value` plus `class` instead of one-line cell snippets; `UsageTable` for `runs/[id]`. 5.6: lucide for stock icons, `ToolChip` has one `SKILLS` table; the launcher bubble, stop square, `Sparkline` and `SyncLogo` stay custom, and the trash, pen, copy and chevron glyphs differ slightly. 5.7/5.8: `NavLink.svelte` (icon, tile, tab, row), `UpdateBanner.svelte`, `use:dismissable`; side effects are that dropdown Escape no longer skips typing targets, the removed scrim buttons are no longer tab stops, and the section jump list now closes on Escape. 5.9: `JsonBlock`, `Disclosure`, `TraceBar`, `Legend`, `CostShareBar`, `LegalPage`, `Switch` with `name`/`onchange`; `+error.svelte` and `runs/+page.svelte` did not fit. 5.10 needed nothing (the German string was already gone). No manual browser pass on a phone was done; the blackhole layout screenshots at 1280px were spot-checked.

---

## Phase 6 - Svelte 5 correctness (runes, effects, derived)

| ID | Change | Delta | Risk |
|---|---|---|---|
| 6.1 | `[date]` page and `detail/[ids]`: `ratings` mirrored from `data.ratings` through `$effect` is a derived-state copy. Use a writable `$derived` (the pattern `newsletters` already uses: `let ratings = $derived({...data.ratings})`). `todayArrived` is one `$derived` plus one effect. Remove `jumpTo`, which duplicates `SectionNav` | -15 | L |
| 6.2 | Class stores: `Assistant.surface`/`Assistant.info` (`state.svelte.ts:86-92`), `ReportPlayer.elapsedMs`/`totalMs`/`chapter` (`player.svelte.ts:77-87`) and `PwaState.installed` are getters recomputed per read (`elapsedMs` slices and reduces on every `timeupdate`, ~4x per second). Make them `$derived` fields. `ReportPlayer.go()` and `#skip` share `#seek` and `#lengthOf`; the labels hard-code "15" and "30" instead of the player's constants. Drop pure aliases `queuedCount` and `retryFailed` | -25 | L |
| 6.3 | Effects that should not be effects: `Navbar:73` and `TabBar:37` close-on-navigation to `afterNavigate` (the `TabBar` one also fires `onOpenChange(false)` on mount); `CommandPalette:78-81` cursor reset where results change; `Panel:30-49` three effects become actions (move `NoteEditor:27 autosize` to `ui/autosize.ts`); `SyncSheet:36` reset in `closeSheet()`; `showBackToTop` effect to `<svelte:window onscroll>` | -40 | L |
| 6.4 | `ServerStatus.svelte:7-33` hand-rolls `setInterval` plus visibility listener; use `poll(check, 20_000, {immediate: true})` from `offline/poll.ts` (the pile-up guard it exists for) | -15 | L |
| 6.5 | `startClient()` in the root layout replaces the five `#started` guards in `Assistant`, `Pwa`, `Push`, `AppUpdate`, `Offline`, each currently started from a different effect | -20 | L |
| 6.6 | `SvelteSet` from `svelte/reactivity` replaces copy-on-write `new Set(...)` in `notes` selection and the `expanded` record in `skills/executions` and `runs` | -15 | L |
| 6.7 | `settings/+page.svelte`: `onMount` fetch becomes a load function; 4 tile links become one `{#each}`. `+layout.svelte`: header-height `ResizeObserver` becomes an attachment; `loggedIn` reads `document.cookie` inside `$derived`, which is not reactive, so document it or set a store from login/logout. `detail/[ids]` hand-rolled `fetched`/`fetching`/`fetchFailed` resource becomes `useAsync` | -30 | L |
| 6.8 | `topics`: `FILTERS` + `counts` + `count()` collapse to one derived list; the three status buttons become an `{#each}` over allowed transitions in `TopicActions.svelte` (-45). With `urlFilter` it also drops the GET form and filters live | -45 | L |

**Status: done 2026-10-05, with these deviations.** 6.1: `todayArrived` was left as is (it latches on a transition, so it is not derivable); the `detail/[ids]` fetch effect stays (there is no `useAsync`, and it is a real effect). 6.3: the `SyncSheet` confirm reset stays an effect (`sheetOpen` is also toggled via `toggleSheet`, so `closeSheet()` alone would not cover it), and the `Panel` scroll-to-bottom effect stays (dependency driven). 6.5: `startClient` keeps two module-level flags (everyone vs the logged-in session) rather than none. 6.6: `runs` and `skills/executions` already use a `$state` record (no copy-on-write), so they were left. 6.7: the `settings` `onMount` fetch was NOT moved to a load function, because the page is deliberately load-free to stay mirrored and offline; the `loggedIn` cookie read was already documented; the `detail/[ids]` `useAsync` was skipped. 6.8: the GET search form stays (`urlFilter` was skipped in Phase 1). No manual browser pass was done.

---

## Phase 7 - Page splits

Each split brings the page under ~250 lines. Behavior must be identical; polling and scroll are the subtle parts.

| ID | Page | Extraction | Delta |
|---|---|---|---|
| 7.1 | `[date]/+page.svelte` 651 to ~260 | `ReportSidebar.svelte` (lines 558-648), `NoReportState.svelte` (497-555), `usePipelinePoll(() => ({date, enabled}))` (213-257), `useReadReceipt(...)` (274-299, as an attachment not `onMount`), pure `buildReportDigest(...)` in `$lib/report/` | -90 (M) |
| 7.2 | `context-builder/+page.svelte` 543 to ~150 | `RunControls.svelte` + `useContextRun()`, `DocSearch.svelte` + `lib/searchHighlight.ts` (`escapeRegExp`, `highlightHtml`, `withHeadingIds`), `QuickLinks.svelte` + `useScrollSpy(ids)`, uses `Tabs` (5.4). Replace the direct DOM class mutation of `search-hit-current` with a `$derived` index applied through an attachment | -60 (M) |
| 7.3 | `notes/+page.svelte` 440 to ~200 | `useNoteSelection(visibleIds)` (replaces select effect, `toggleSelect`, `toggleSelectAll`, `endSelection`, three near-identical `bulk*` which become one `runBulk(label, fn)`), `useNoteDrafts()` (124-198), `BulkBar.svelte` (388-440); merge `scopeCounts`/`counts` into one pass | -40 (L-M) |
| 7.4 | `runs/[id]/+page.svelte` 385 | `weight()`, `stepSum`, `groupWeights` into `runTrace.ts`; `data.run.durationMs ?? tree.totalMs` (3x) into one `$derived`; uses 5.5 and 5.9 | -70 (L) |
| 7.5 | `sources/[name]/+page.svelte` 292 | `DeliveryCard.svelte` (204-266), `SourceHeader.svelte` | -50 (L) |
| 7.6 | `chat/+page.svelte` | `CorrectionsSidebar.svelte`, uses `Tabs` | -20 (L) |
| 7.7 | `Navbar`, `CommandPalette`, `TriageCard` (242, 237, 237) | after 5.6-5.8 land they drop on their own; re-measure | - |

**Status: done 2026-10-05, with these deviations.** 7.1: `[date]/+page.svelte` is 340 lines, not ~260 (the rest is the report markup); the extractions are `ReportSidebar`, `NoReportState`, `usePipelinePoll`, `useReadReceipt` (an effect-based helper rather than an attachment, so it also re-arms per date), `buildReportDigest` and a `report/view.ts` for stats, action placement and nav targets. 7.2: 231 lines; `RunControls` + `useContextRun`, `DocSearch`, `QuickLinks`, `useScrollSpy` (`ui/scrollSpy.svelte.ts`), `searchHighlight.ts`, `ui/details.ts`; the `search-hit-current` class is still toggled on the DOM inside `DocSearch` (no attachment). 7.3: 234 lines; `useNoteSelection` (one `runBulk` replaces the three bulk functions), `useNoteDrafts`, `BulkBar`, and `counts`/`scopeCounts` are one pass. 7.4: `weight`, `stepSum` and `groupWeights` live in `lib/runUsage.ts`, not `runTrace.ts` (that file is pure, tested alone and at its size limit; usage needs the pricing config); `runMs` was already one `$derived`. 7.5: `DeliveryCard` and `SourceHeader` sit next to the route. 7.6: `CorrectionsSidebar` (chat already used `Segmented`). 7.7: `Navbar` 157, `CommandPalette` 231 and `TriageCard` 238 are under budget after Phase 5. No manual browser pass was done; the full check including blackhole passes.

---

## Phase 8 - Offline layer and service worker

Only with a full blackhole run after every step.

| ID | Change | Delta | Risk |
|---|---|---|---|
| 8.1 | **IndexedDB performance (biggest runtime win).** `repo.reportDates` (`:92`), `repo.archive` (`:105`) and `offline.refresh()` (`state:135`, runs on every sync end and outbox change) load all 60 full reports with rendered HTML just to read dates/counts. Add `db.keys(store)` (report `id` is its date). `repo.entity()` (`:258`) loads every appearance and filters in JS: add an `entityId` index (db version 5 upgrade, covered by `offline-db.test.ts`) | +15 lines, 60 structured clones to 0 per call | L-M |
| 8.2 | `offline/db.ts`: `get`, `getAll`, `put`, `del`, `clear`, `bulkPut`, `bulkDelete` (115-214) are one promise wrapper seven times; one `run(store, mode, fn)` | -45 | L |
| 8.3 | Single type-only `#lib/mirror/types.ts` for the shapes duplicated across server snapshot builders, `offline/repo.ts`, `snapshotCache.ts`, `net.ts` and `intents.ts` (`MirroredReport`, `SnapshotBody` x2, `Keyed` x2, `Fetcher` x2). `entriesOf(structured)` in `report/types.ts` replaces 4 copies of the report-entry flatten (`snapshot.ts:176`, `reports.ts:51-61`, `offline/search.ts:73-83`, `[date]/+page.svelte`) | -60 | L |
| 8.4 | `server/offline/snapshot.ts` 385 to ~260: seven `build*` functions made of `(row.x as T|null) ?? null`; use SQL aliases with the typed `sql<T>()` (1.12). ETag hashes depend on key order and null vs undefined; self-heals with one full sync because the version is part of the ETag | -120 | M |
| 8.5 | Window-free `offline/guard.ts` for the stamp check, budgeted body read and Response rebuild for 204/205/304 that `net.ts:205-215` and the service worker's `syncFetch` (`service-worker.ts:361-379`) duplicate. The service worker must stay free of `$app/navigation` | -40 | M |
| 8.6 | `intents.ts`: make `Intent` a discriminated union (removes 9 `payload as {...}` casts), and keep `apply`, `send`, `stores`, label together in one table per kind (today `INTENT_LABEL:33` and `storesOf:153` live apart). `outbox.ts`: `failed()` re-implements `sortedOutbox`, `retryFailed` repeats the tail of `enqueue` | -50 | M |
| 8.7 | `routes.ts` 401 split into three modules (icons + registry, offline tiers, `ONLINE_ONLY` prose at 340-383); `service-worker.ts` 512 (~130 lines of header prose) into `sw/{cache,sync,push}`, still built through `$app/manifest`; `server/triage.ts` types and `outcomeOf` split from the query | 0 | M |
| 8.8 | **[needs go-ahead]** Remove the `app.html:49-67` "safe to delete after a few weeks" inline-SW migration block and `INLINE_SW_MIGRATION_HASH` in `hooks.server.ts:106`; keep the `register()` line. Confirm no device is still on `/sw.js` | -20 | L |
| 8.9 | Optional: `snapshotCache.fingerprint()` (`59-87`) md5s whole tables on every snapshot request; reuse the result for a few seconds | perf | L |

**Status: done 2026-10-05, with these deviations.** 8.1 to 8.9 each landed as its own commit with a full `bun run check` (blackhole flaked under load a few times and always passed on rerun). 8.1/8.2 (e284c35): `db.keys` replaces cloning all full reports for `reportDates`/`refresh`; `entityAppearances` has an `entityId` index (DB version 5, upgrade test); the promise wrappers collapse into `run`/`runBatch`. `archive()` still reads full reports because it needs the summary text. 8.3 (142ba3f): snapshot and mirror shapes live once in `lib/mirror/types.ts` and `entriesOf()` replaces three flatten copies; the `[date]` page's count is personal-only and was left alone; `net.ts` keeps its own wider `Fetcher`. 8.4 (9f3fa80): `server/offline/snapshot.ts` 385 to 298 lines, the simple builders use aliased SQL and typed rows. **The new SQL was only type-checked, never run against a live Postgres**, and the row key order changed, so ETags change and every client does one full sync after deploy; verify against the real database after deploy. 8.5 (508f0c5): `offline/guard.ts` shares `isOurs` and `buffered` between `net.ts` and the worker. 8.6 (1f8a143): `Intent` is a discriminated union with one handler table per kind and the outbox shares one `queue()` tail; behavior change: `retryFailed` now also requests a Background Sync flush. 8.7 (dbe7842, 7a396e4): `routes.ts` is split into routes/tiers/onlineOnly but is still 306 lines, because the `ROUTES` registry must stay in `routes.ts` (`scripts/check-route-surfaces.ts` parses it as text); `service-worker.ts` is a ~45 line entry over `src/sw/{shared,cache,sync,push}.ts`; `server/triage.ts` went 365 to 248 with client-safe types in `lib/triage/types.ts`. 8.8 was already done before the phase (557af8f, the owner confirmed no device on `/sw.js` on 2026-10-04); only a stale `vite.config.ts` comment was left, fixed in 2d6a410. 8.9 (24d12ea, 307d35d): the snapshot fingerprint is reused for 5 s with the in-flight query shared; failed queries are not cached.

---

## Phase 9 - Tooling, tests, CSS, docs

| ID | Change | Delta | Risk |
|---|---|---|---|
| 9.1 | `dashboard/scripts/blackhole/run.ts` 826 to ~120 runner: per-route step data (~lines 230-487) to `steps.ts`, helpers (`remaining`, `visible`, `clickLink`, `expectQueued`, `undesigned`, `INDICATOR`) to `helpers.ts`, `runLane` (521-697), `checkBudgets`, `checkDelivered`, `startServer` to `lane.ts`/`server.ts`; a `tap(page, locator, deadline)` helper for the ~20 repeated `.click({timeout: remaining(deadline)})` | -40 | L |
| 9.2 | `scripts/lib/check-runner.ts` shared by `scripts/check.ts` and `dashboard/scripts/check.ts` (identical `q`, `Out`, `text`, `hasWarnings`, `step()`, arg parsing); trim the 20-line doc headers | -50 | L |
| 9.3 | `dashboard/scripts/contrast.ts` (163): parse the `--color-*: light-dark(...)` values out of `app.css:133-230` instead of its hard-coded `DARK`/`LIGHT` tables (drift risk to zero) | -60 | M |
| 9.4 | **New check step: file-size budget** (fails above 350 `.ts` / 250 `.svelte` lines with an explicit allow-list for justified exceptions such as the MP3 parser). Keeps the codebase from bloating again | +30 | L |
| 9.5 | Tests: split `tests/news.test.ts` 560 into `tests/news/{config,validate,format}.test.ts` plus `tests/fixtures/news.ts` (`story`, `item`, `clean`, `WINDOW`); remove the "gate on news stories/newsletter items" block (`news.test.ts:483-541`) that duplicates `gate.test.ts:99-257` (-60); shared `tests/fixtures/db.ts` mock builder (`phase2-extract.test.ts:30-55` and others reinvent it). Verify each of the 7 files in `tests/mocks/` is imported | -60 | L |
| 9.6 | `app.css`: move the ~150-line `.report-body`/`.chat-body` prose rules (450-640) to `lib/report/prose.css`, imported from `app.css` (split, not a reduction). Leave the cerberus ramps (133-230, referenced by Skeleton). Check `Toast`, `SyncLogo`, `SyncSheet` `<style>` blocks (~200 lines) for what Tailwind could replace | -30 | L |
| 9.7 | Docs trim, done by `docs-committer` at commit time, not by hand: `docs/skills.md` Registry (29 names, duplicates `skills/` and the loader) becomes a pointer; `docs/dashboard.md` route paragraphs (~84 lines, many 1000+ chars) become one line per route plus a pointer to `routes.ts`; note new modules in the relevant docs; update the index in `CLAUDE.md` | -80 | L |
| 9.8 | Optional: merge `bun.lock` + `dashboard/bun.lock` into one Bun workspace (one `node_modules`). Needs re-testing of `dashboard/bunfig.toml`, `#lib` imports and `scripts/deploy.ts`. Align the root (`^7.0.2`) and dashboard (`^6.0.3`) TypeScript versions if svelte-check supports 7 | -1 lockfile | M |

**Status: done 2026-10-05, with these deviations.** 9.1 (0fb43db): `blackhole/run.ts` is a ~75 line runner over `helpers.ts`, `steps.ts`, `links.ts`, `verify.ts`, `lane.ts` and `server.ts`, with a `tap()` helper. 9.2 and 9.4 (9e43779): `scripts/lib/check-runner.ts` is shared by both check scripts, and a new `file-size` step (`scripts/check-file-size.ts`) enforces 350 lines for `.ts` and 250 for `.svelte`; five files carry their own ceiling in its `EXCEPTIONS` table (`blackhole/fixture.ts`, `notes/store.ts`, `runTrace.ts`, `[date]/+page.svelte`, `runs/[id]/+page.svelte`). 9.3 (1fbd840): `contrast.ts` parses the `light-dark()` ramps out of `app.css`, output byte-identical. 9.5 (85c498a): `tests/news/{config,validate,format}.test.ts` plus `tests/fixtures/news.ts`; the 7 duplicated gate tests went (62 to 55 tests). The shared `tests/fixtures/db.ts` was NOT built (the db mocks have genuinely different shapes) and `tests/mocks/` does not exist. 9.6 (79dc820): the `.report-body`/`.chat-body` rules live in `lib/report/prose.css`; the Toast, SyncLogo and SyncSheet `<style>` blocks stay (keyframes and SVG rules). 9.7 (7b77831): the skills Registry is a pointer and the route paragraphs in `docs/dashboard.md` are shortened. 9.8 (62fe2ba): one Bun workspace and one root `bun.lock`; `deploy.ts` runs a single install, which has not run on pronix yet (a deploy dry-run needs the commits pushed). Dashboard packages still install into `dashboard/node_modules`. **TypeScript was not aligned**: `svelte-kit sync` crashes under TS 7 (no `ts.sys`), so the dashboard stays on ^6.0.3. The fresh lockfile re-resolved kit to stable 3.0.0, which exposed two things, fixed in their own commits: kit 3.0.0's `builder.mimeTypes` never learns `.html` from prerendered pages, so adapter-node served `/privacy` and `/terms` without a content-type (workaround `withHtmlMime()` in `vite.config.ts`, remove once kit fixes it), and a debounced filter URL write on `/entities` and `/notes` could overtake a tap on a result (f01fd55). The dashboard is now on stable SvelteKit 3.0.0 and adapter-node 6.0.0 (42a77c6).

---

## Phase 10 - Comment diet

CLAUDE.md says "no multi-paragraph docblocks", but `schema.ts` (234 comment lines), `propose.ts` (98), `push.ts` (45 of 137), `questions/store.ts`, `reconcile.ts`, `service-worker.ts` (~130), `dashboard/src/env.ts`, `util/time.ts` carry paragraph headers that repeat `docs/`. Cut each to one line where the WHY is already documented, keep the ones that state a hidden invariant. Estimated **-250 to -350 lines**, risk none. Do it last so splits do not fight with comment edits.

**Status: done 2026-10-05, with these deviations.** The brief changed from "cut comments" to "optimise for Claude readers": comments were removed where they restated code, narrated incidents already in git history or `docs/`, or were banners, and **added** where they save opening other files. Net about -370 comment-or-blank lines across ~260 files (about 1,370 added, 1,745 removed); the target of -250 to -350 was met only because the additions are short. What was added: a 1-3 line role header on non-trivial files (caller, what it reads and writes, whether a dashboard page is mirrored), contracts on exported functions that the signature does not show (throws, units, idempotency, side effects), and coupling pointers ("must stay in sync with X", "parsed as text by scripts/check-route-surfaces.ts"). Only comment lines were changed (checked with a diff filter; two glued-comment formatting slips in `offline/intents.ts` and `server/postgres.ts` were fixed). Two files crossed the `file-size` budget because of the new headers and had them shortened. `src/db/schema/*` was not cut further (already one line per table), `skills/` at the repo root and most of `src/types`, `src/settings` were left alone. The `blackhole` step failed three times in a row while the agents were still running and passed twice after, so those failures were load flakes; each third of the patch also passed blackhole on its own against HEAD. Comment accuracy was verified by the agents reading code and grepping callers, not by tests, so a spot check of the new headers is the cheapest way to judge them.

---

## Review overview: what was done, skipped, or done differently (all phases)

For going back over decisions. Details per item are in the phase status blocks above; this lists only where the outcome differs from the proposal or needs a second look.

### Skipped or void (not done at all)
- **1.3b** (Berlin-based `todayKey()`): void, the backend is UTC everywhere.
- **2.4** (delete `db/relations.ts`): skipped by the owner; the file is now unused by the pipeline but stays.
- **3.8** (auto-discover skills with `Bun.Glob`): skipped, the loader must stay synchronous and skills import `provenanceOf` from it (cycle). Adding a skill still means editing the file, the loader and `surfaces.ts` or `BRIDGE_ONLY_SKILLS`.
- **1.16 `errorFrom`, 1.18 `urlFilter`/`enhanceWith`/`useFormToast`/`pageContext`**: skipped as wrappers that save a line or two.
- **4.12 `SourceQualityRow` merge**, **5.1 `Button.svelte` wrapper**, **6.7 settings load function and `useAsync`**, **9.5 `tests/fixtures/db.ts`**: skipped (different shapes, utilities were enough, page is deliberately load-free, mocks genuinely differ).
- **Owner decision 3** (unused bridge endpoints): stale, the GET routes were already removed (`f0a8b0b`, `21ba7c9`); the remaining no-caller routes (`POST/DELETE /api/prompts*`, `POST /skills/execute`) stay as the documented manual API. **Owner decision 4** (dashboard on Drizzle): deferred, tracked in `docs/todo/later.md`.
- **9.8 part:** TypeScript versions not aligned (`svelte-kit sync` crashes under TS 7).

### Done differently or only partly
- **Line count goal missed in places:** Phase 3 net is about +180 lines (splitting adds imports and headers); Phase 5 is about -350, not -850; `[date]/+page.svelte` is 340 (target ~260); `routes.ts` 306 (must stay one text-parseable registry); `notes/store.ts` 367; `corrections.ts` did not shrink. Five files carry their own ceiling in `scripts/check-file-size.ts` `EXCEPTIONS`.
- **2.1** also deleted the `SELF_EMAILS` env var, `PROMPT_VARIABLES` and `Skeleton.svelte` (asked first). **2.5:** only comments reworded, the assistant surface text and `propose_prompt_version` were settled afterwards: the skill is now `high` risk, so a proposal parks on `/skills` and confirming it activates the version (the pending queue shows long parameters in a wrapping box, `ParamList.svelte`).
- **3.12:** stopword list deliberately not shared with `implicit-feedback.ts`. **3.17:** only verified with `context-builder:dry`.
- **5.x:** button variants were normalised (border, padding, hover colours moved by about a pixel); several tinted boxes, forms and details were not converted to `Card`; the launcher bubble, stop square, `Sparkline`, `SyncLogo` stay custom.
- **7.1:** `useReadReceipt` is an effect helper, not an attachment; `search-hit-current` is still toggled on the DOM in `DocSearch`.
- **9.x:** `deploy.ts` runs one root install; dashboard packages still install into `dashboard/node_modules`; the `withHtmlMime()` workaround in `vite.config.ts` exists for a kit 3.0.0 bug.

### Behavior changes (each should have its own commit message; double-check these)
- 4.6: a cross-feed or cross-account duplicate is now skipped instead of throwing on the unique key.
- 5.7/5.8: dropdown Escape no longer skips typing targets, removed scrim buttons are no longer tab stops, the section jump list closes on Escape.
- 8.6: `retryFailed` now also requests a Background Sync flush.
- 4.12: `/sources/[name]` now gets `runDate` as text, like the list.
- 8.4: ETags changed (one full sync per client after deploy).

### Never verified (needs you)
- **8.4 snapshot SQL** was type-checked but never run against a live Postgres: verify after deploy.
- **2.8** migration `0042_drop_questions_blocks_until.sql` must be applied by hand before deploying.
- **9.8** single `bun install` on pronix has not run yet.
- **3.17** resume, `--from-index` and a real context-builder run want one manual pass.
- No manual phone or browser pass was done for Phases 5, 6 and 7 (only blackhole screenshots at 1280px).
- Phase 10 comment accuracy: verified by reading code, not by tests.

### Smells the Phase 10 agents noticed and left alone (code or prompt changes, so not in a comment pass)
- `src/db/schema/pipeline.ts:~112`: `report_audio` variant documented as `<model>:<voice>`, the code writes `<model>:<voice>:<speed>`.
- `news/store.ts` `priorities()` has no `orderBy`, yet `research.ts` and `run.ts` treat index 0 as the reader's first priority.
- `context-builder/progress.ts` still names counters `sonnetTokens` though they count OpenAI tokens; `CheckpointState` has a `"resume"` mode nothing produces; `updateProgress` imported unused in `context-builder/run.ts`; extract-email schema says summary max 60 chars, code slices to 80.
- `SKILL_TOUCHES` (`ai/chat/tools.ts`) is hand-maintained: a new writing skill missing from it silently never invalidates the page.
- `routes/notes.ts`: a `base_updated_at` conflict still applies the edit (last write wins), `_conflict` is informational only.
- `skills/execute.ts`: a rejected `critical` skill is settled without a `result` reason, unlike other rejects.
- `ai/surfaces.ts` `report` prompt has a quick-action paragraph between two list bullets (prompt text, untouched).
- Duplicate `SourceFailure` types (`evaluation/baseline.ts` vs `phase1-ingest.ts`); `as any` casts remain in `pipeline/phase6/*` and `entity-context.ts`.
- `scripts/jev-baseline.ts` and the three `*-dry-run.ts` scripts are not wired into `package.json`.
- Unchecked claims: `docs/scoring-formulas.md` says a Sunday 02:00 `prune` job exists; `actions/propose/mails.ts` points at a `docs/todo/now.md` entry.

---

## Owner decisions needed (not started without a yes)

3. **Unused bridge endpoints** (no `${API}/...` caller in `dashboard/src`): `GET /api/sources`, `GET /api/skills/executions`, `GET /api/chat/conversations` and `/:id`, `GET /api/context/corrections`, `GET /api/prompts` and `/effective`, with their store readers (~40 lines). `docs/security.md` and `docs/skills.md` describe the prompts routes and `POST /skills/execute` as a deliberate manual API, so those stay unless you say otherwise.
4. **Dashboard DB driver:** the dashboard uses the `postgres` npm package with raw SQL (74 raw-SQL lines, 29 importers); `src/` uses Bun SQL via Drizzle. Option A (planned): typed `sql<T>()` helper (1.12), low risk. Option B: move the dashboard to Drizzle with the shared schema or `Bun.SQL` (-15 lines, drops a dependency and every hand-rolled row type, but touches 29 files and tagged-template semantics differ for `sql.unsafe` and array params). Recommendation: A now, B only as a later project.

## Estimated outcome

| Phase | Net lines |
|---|---|
| 1 Shared primitives | -1,000 |
| 2 Dead code | -230 |
| 3 Backend modularization | -800 |
| 4 Backend performance | -250 (plus fewer queries) |
| 5 UI primitives | -850 |
| 6 Svelte correctness | -205 |
| 7 Page splits | -330 |
| 8 Offline layer | -380 |
| 9 Tooling, tests, docs | -340 |
| 10 Comment diet | -300 |
| **Total** | **about -4,700, overlap between audits already removed where noticed; plan on -3,500 to -4,500 measured** |

## Suggested execution order

1 (all of it), 2, 3.3/3.1/3.4 (the big backend files), the rest of 3 and 4, 5.1-5.3 (browser-verify), 6, 5.4-5.9, 7, 8 (one step at a time), 9, 10. Phases 3-4 (backend) and 5-8 (dashboard) share only Phase 1, so they can run in parallel sessions or worktrees if the working dir is shared (merge Phase 1 first).
