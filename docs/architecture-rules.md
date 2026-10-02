# Architecture rules (non-negotiable)

The invariants of the system. Read this before any change that touches extraction, synthesis, the gate, corrections, notes, the assistant or prompts. A change that violates one needs a conscious decision to change the rule itself, documented here, not a quiet workaround.

## Pipeline structure

- **Two stages, extraction then synthesis.**
  - Extraction outputs only structured JSON: no prose, no judgments.
  - Synthesis sees only compressed extraction output, never raw email HTML.
  - Models come from `OPENAI_MODEL_EXTRACTION` and `OPENAI_MODEL_SYNTHESIS` (both default to `gpt-6-luna`, see `src/ai/openai.ts`). The split is the rule, not the model.
- **No embedding path inside a pipeline phase.**
  - All retrieval is explicit keyword/entity lookup against Postgres; archive search is `tsvector` keyword search.
  - A vector store (pgvector, local embeddings, hybrid ranking) is planned, but as its own project with its own design (`docs/todo/later.md`), never an increment to a phase about something else.
  - Vector retrieval is for searching the archive, never for deciding what enters a report: a similarity threshold silently dropping an item is the failure mode that matters.
- **Every item the pipeline discards says why, in the database.**
  - An item can leave the chain in five places, and `included_in_report = false` explains none of them. Each drop is recorded where it happens:

    | Exit | Record |
    |---|---|
    | IMAP ingest | `ingest_drops` |
    | Before Phase 2 | absent extraction row plus `source_quality.is_active` |
    | Phase 3 relevance gate | `extractions.gate_*` |
    | Outside Section 1's 30-item capacity | `extractions.synthesis_handoff` and `synthesis_order` |
    | Synthesis did not cite it | the report's own refs |

  - `src/pipeline/gate.ts` owns the gate decision as one pure function with a named reason per outcome. Section 1 sorts gate-passed newsletter claims by effective relevance and extraction ID, sends the first `SECTION1_CAPACITY` (30, `src/pipeline/section1-handoff.ts`) and records the rest as `outside_synthesis_capacity`.
  - Never add a filter that silently drops an item from a report: a new one gets a reason code, and a new personal source gets its own drop log the way `imap.ts` has one.
- **A source that never delivered is said out loud, on the report.**
  - The sixth exit has no per-item record: mail never fetched (mailbox timeout, rejected login) or an RSS feed whose fetch failed. Phase 1 is deliberately tolerant (it logs the failure, counts the source as zero, carries on, and the run still records `completed`), so every other signal on the page says the morning went fine.
  - `ingestFailures()` in `dashboard/src/lib/pipeline.ts` turns the Phase 1 and `news` entries of `pipeline_runs.step_errors` into a source plus one of five fixed kinds (`config`, `timeout`, `auth`, `connection`, `unknown`). `IngestWarning` renders it above the briefing and on `/[date]/triage`; the News section repeats a missing desk where the news is read. It reads the newest run of that date only, because that is the run the report came from.
  - Tolerance in the pipeline is only defensible while the dashboard says what was tolerated: a new ingest source that can fail silently needs its failure on this path too.
- **Reports are final.**
  - `daily_reports`, `extractions`, `raw_items` and `active_topics` belong to the pipeline and to Phase 6's `<!--SYSTEM-->` parsing. No skill may write them, so the assistant cannot; `read_report` is read-only and the only skill that touches a report.
  - `scripts/check-skill-writes.ts` (part of `bun run check`) fails the build if a skill inserts, updates or deletes one of those tables.
  - A wrong fact in a report is fixed forward: a note for tomorrow, or a `revise_context` correction for every future briefing. Never rewrite what the pipeline produced.

## Personal data scope

- **`contacts` is an email sender directory, not a social graph** (owner's decision, 2026-09-10).
  - It answers "mail arrived from this address, who is that and how much should triage care", nothing more.
  - No messaging platform is ingested, live or via export (Discord, WhatsApp, Instagram, WeChat, Line, KakaoTalk, VK, Zalo, Facebook, X, Telegram, LinkedIn).
  - A small table is the steady state, not a seeding bug: the first Context Builder run produced 6 rows from 1432 emails. Relationship context comes from the context document and the `personal` notes.
- **Credentials never reach any cloud API.**
  - Enforced at the fetch choke point, not in a consumer, so no later call path can bypass it. Today: `context-builder/sources/keep.ts` drops every Keep note labelled `Credentials` (passwords, card and bank details, identity-document numbers) before any consumer sees it; the list is `CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS`.
  - Any new personal source needs its own equivalent filter.
- **Diary and other intimate content is deliberately in scope** (owner's decision, 2026-09-10). The context document is meant to be thorough about who the user is. This content goes to the API like anything else, under `store: false`, and supersedes the earlier "diary never reaches a cloud API" rule, which is now narrowed to credentials.

## Context and memory layers

- **Harvested context is never overwritten, only adjusted and complemented** (owner's decision, 2026-09-10).
  - The Context Builder's document is read-only to everything downstream. `src/context/corrections.ts` is the single writer and carries the detailed reasoning. `TARGET_KINDS` is `document | entity | contact`: standing rules are not a correction target (see the notes layer below).
  - Corrections live in `context_corrections`, an append-only layer injected alongside the harvest that outranks it in the daily prompts. The wrong text is kept as `supersedes_text`. Rows are never deleted or edited, except `status` flipping to `reverted`.
  - `entities` and `contacts` are the one exception: a correction merges the named fields into the row, because `phase3-context` and Section 2 read them directly. The pre-merge row is snapshotted into `previous_state` and the row is marked `locked` so a re-seed cannot clobber it.
  - Removal follows the same rule. `remove_context_item` archives an entity (`status = 'archived'`) or sets a contact's `removed_at`, locks the row and keeps the pre-removal row on the correction, so `revert_context_revision` restores it. Every reader of `contacts` skips `removed_at` rows (classification, Phase 3 context, question reconcile, `read_context`, the offline snapshot), and `revise_context` refuses a removed row until the removal is reverted. `add_contact` adds a sender the directory lacks (or a removed one) and reverts as a removal.
  - Never add a code path that rewrites the context document in place.
- **Notes are the mutable working layer, and the only one.**
  - `notes` rows are edited in place, but only through `src/notes/store.ts`, the single writer. Every mutation appends the pre-change state to `note_revisions`, and a delete only sets `deleted_at`, so dashboard and chat can both undo.
  - Every reader must filter `deleted_at IS NULL` and skip expired notes, `expires_at IS NULL OR expires_at >= runDate` (a note is live through its expiry day). Currently `phase3-context.ts`, `search/slots.ts` and, for intel notes, `news/run.ts`.
  - Never write `notes` directly from a new caller; never give the context document, entities or contacts this treatment.
  - **Standing rules are notes** (owner's decision, 2026-10-02, dropping harvest immutability for rules: a chat misedit is undone through `note_revisions` and the chat history). The Context Builder seeds the Keep rules as `personal` notes through `seedHarvestedNotes` (`notes.source_key = keep_rule_<note id>`, `created_by = 'harvest'`). A key that already has a row is left alone, trashed or edited included, so a re-run never resurrects a deleted rule or overwrites a changed one; only a live row nobody has touched follows the Keep note's new text (the old text becomes a revision). `pruneDeletedNotes` never purges a row with a `source_key`, because the trashed row is the tombstone. The `standing_context` table is dropped (migration 0039): the rules reach Section 2, question reconcile and quick actions as `notes_personal`.

## Report content

- **The News section is the reader's only news, so recall is the goal and every link is checked** (owner's request, 2026-09-25).
  - *Caps:* recall is tempered by hard per-section story caps in `NEWS_CAPS` (`src/news/config.ts`): top 6, home 4, also-country 2, 4 per field and 8 across fields, talk 3, serendipity 1. They feed the editor prompt and `renderNewsFallback`, and `enforceNewsCaps` (`src/news/format.ts`) enforces them in code on the editor's output too. Change the numbers in `NEWS_CAPS` only.
  - *Desks:* `src/news/run.ts` and `src/news/research.ts` run six desks in parallel with separate mandates. Each plans an initial Brave News Search round, inspects results, plans a follow-up round and reads Brave LLM Context's extracted page text. Fixed per-desk budgets (`SEARCH_BUDGET`) total 27 Brave requests; the three Section 1 slots bring a full scheduled run to 30, subject to the shared daily cap. `src/search/brave.ts` spaces requests across callers.
  - *Storage:* each desk stores one `raw_items` delivery per date (`source_type = 'web_news'`, `source_name = 'news:<desk>'`, reused on a re-run) with one extraction per story.
  - *Validation:* `src/news/validate.ts` records what the search can prove (a source the search returned, a development inside the window, no duplicate of another desk's story, not told on an earlier day). The gate turns each into a named reason, so a held-back story is on `/[date]/triage` like any other drop.
  - *Links:* the editor synthesis (`news` prompt section) writes the prose; `src/news/format.ts` maps its short ids to extraction ids and attaches only checked links, removing any link the model wrote itself. Never let a model compose a URL that reaches the report.
  - *Privacy toward search:* a desk's queries go to a search engine, so it sees only the home location (`NEWS_HOME_*`), the interests section of the context document (`PIPELINE_CONTEXT_SECTIONS_NEWS`, default 3), the intel notes and the last days' headlines. Never the personal sections.
  - A desk that fails or is not configured is recorded under step `news` and said on the report.
- **The spoken report is a cache of the final report, and the request never names the text** (owner's request, 2026-10-02).
  - `src/audio/chapters.ts` (pure) strips markdown, links and refs comments from `report_json` into speech text and splits it into chapters: one per urgency group, news group, briefing domain, and the also-noted block. A chapter key is a hash of its spoken text.
  - `src/audio/store.ts` is the single writer of `report_audio`. A request names only a date and a key; the text is read from the stored report, so the endpoint can only ever pay to speak what the pipeline produced, and a key that no longer matches (the report was regenerated) is a 409. It never touches `daily_reports`.
  - A chapter is spoken on its first request and cached as MP3 keyed by date, text hash and `model:voice:speed`, so each chapter is paid for once per speech setting. Rows older than 30 days are dropped when a chapter is generated, except the day just spoken.
  - `speak()` is the one model call that cannot pass `store: false` or the flex tier (the speech endpoint has neither parameter); see CLAUDE.md. The spoken report text therefore reaches OpenAI without `store: false`.
- **Quick actions are proposed by a separate call.**
  - One-tap buttons beside a personal entry for four kinds: add an event, move an event, add a to-do, mark a to-do done. Propose whenever a mail clearly fits one of them, rather than defaulting to none (owner's request 2026-09-26 for conservatism, loosened 2026-09-30 after under-firing).
  - `src/actions/propose.ts` runs one `extractJson()` call (prompt section `quick_actions`) alongside Section 1, over the day's gate-passed personal mail plus automated mail the classifier flagged for a calendar entry or a to-do. It reads the mail text, because the classification carries no times or places.
  - The model sees short ids only; code maps them back, parses every time as `Europe/Berlin` wall clock (`src/util/time.ts`), checks an event against the calendar on its own day and a task against the whole open list, strips links from everything it writes, and caps at `MAX_PER_MAIL` (2) and `MAX_ACTIONS` (6) per day. What code throws out is kept as `discarded` with a reason.
  - Actions live in `report_actions`, not in the report, because they have state. `src/actions/store.ts` is the single writer, a re-run replaces only untouched proposals, and a tap runs the skill once through `executeSkill()` however often it is pressed. Never queued offline.
  - Tune with `bun run scripts/actions-dry-run.ts [date]` (one real call, nothing stored).
- **Questions are one standing queue, answered one at a time** (owner's request, 2026-09-28).
  - *Queue:* `questions` holds one row per question, open until answered or dismissed on `/questions`. Candidates from every source join the same queue whether or not older ones are answered: mail with `unknown_context`, entities the graph keeps citing without placing (`lowConfidenceEntityCandidates`, `src/pipeline/entity-questions.ts`), known contacts a mail now sits oddly against (`staleContextCandidates`, `src/pipeline/stale-context-questions.ts`), and the weekly review's questions.
  - *Reconcile:* one `extractJson()` call per run (prompt section `questions`, `src/questions/reconcile.ts`) keeps the queue free of repeats. A candidate attaches to an open question about the same thing; an open question is rephrased, merged, or closed because notes, corrections, the context document or a recent answer already settle it. It fails open (a candidate the model mishandles is asked as it stands), and a closed row keeps its reason and can be reopened.
  - *Writers:* `src/questions/store.ts` is the single writer; the dashboard writes through the bridge.
  - *Nothing waits on the queue:* the gate leaves a run's candidates open and Section 2 gets only item answers of the last 7 days (`recentAnswers()`), so an unanswered question never delays a briefing and an answer is used from the next run on.
  - *The assistant raises questions too:* `create_question` (`kind = 'chat'`, on every surface, at most 10 open assistant-asked questions, an exact duplicate returns the open one), prompted by a rule in the base chat prompt (`src/ai/chat/context.ts`).
  - *Answers are acted on at once:* after every non-review answer, `src/questions/process-answer.ts` runs one chat turn on the `questions` surface, fire-and-forget from `POST /api/questions/:id/answer` (or the `reprocess` op), and records `answer_status` (`running | done | failed`), `answer_outcome` and `answer_conversation_id`. Every change is an ordinary skill call, so risk gating, surface policy and reversibility apply. The question's mail details are untrusted text; only the answer is an instruction. Review answers still go through `absorbReviewAnswers`.
  - Tune with `bun run scripts/questions-dry-run.ts [--apply]`.

## Assistant, prompts and language

- **The assistant's capabilities are per page, enforced at the choke point.**
  - `src/ai/surfaces.ts` maps each dashboard route to a surface with a declared skill list, a prompt fragment and the widget's sentence starters (empty-state hints the owner finishes, so each opens with a trailing space and fits any page content). `executeSkill` checks the surface before the risk level and logs a rejection to `skill_executions`; the chat loop additionally offers only that surface's tools.
  - An unknown route falls back to `global`, which touches nothing structural. A client-claimed surface can never widen what its route allows.
  - `list_questions` and `create_question` are on every surface. `/questions` has its own `questions` surface with the broad edit skills, because that is where answers are acted on.
  - `send_email`, `send_mail`, `create_file`, `open_project_in_editor` and `update_calendar_event` are on no surface.
- **Prompt changes require human approval.**
  - The weekly meta-run proposes diffs; nothing auto-applies. `/prompts` handles review and activation.
  - `prompt_versions` is an override layer, not the source of truth: the constants in `src/ai/prompts/` are the baseline, an active row replaces the baseline for its section, and an empty table means the code baseline runs.
  - Every stage resolves its prompt at run time through `src/ai/active-prompts.ts`, never at import time, so activation takes effect on the next run without a deploy. A stage that imports a prompt constant directly is a bug: it makes the approval flow decorative.
- **Language is an allowlisted code, never free text, and parsed markers stay English** (owner's request, 2026-10-02).
  - `user_settings` holds a two-letter content language and UI language, each behind a DB `CHECK`. The dashboard validates against `src/config/languages.ts`, and the pipeline re-resolves the stored code through the same list before it reaches a prompt, so a crafted value can never become prompt text. A prompt receives only the English name of that code, through `{{language}}` (`src/ai/prompt-vars.ts`).
  - Prompts the reader reads carry the shared `OUTPUT_LANGUAGE` rule (`src/ai/prompts/language.ts`), which keeps what code parses in English: the `##` and fixed `###` headings, refs comments and SYSTEM block keys. `report-json.ts` and `news/format.ts` match them by name, and a translated one renders wrongly without failing.
  - Extraction, the news desks and answer classification stay English on purpose. `LANGUAGE_SECTIONS` in `src/ai/prompt-catalog.ts` lists the sections that must carry `{{language}}`.
  - The UI language is stored but does nothing until Paraglide is installed (`docs/todo/later.md`).
- **The dashboard is the primary interface: never send emails for system events.** The goal is to not read email. Errors, alerts and notifications go to the dashboard only (`pipeline_runs`, `notes`, the UI). `send_email` and `nodemailer` exist only for user-initiated AI actions, not monitoring.
