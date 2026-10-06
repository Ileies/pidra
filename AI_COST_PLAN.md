# AI cost plan

Open work only. Merged from a Claude and a Codex read-only audit (2026-10-07). Done so far and removed from this list: the `entities_graph` strip from Section 1 and deepen payloads, the single-call newsletter extraction with entity graph, the concurrent-run and reprocess guards, and the Force full confirm.

Every token figure below comes from caps and prompt sizes, not from the DB. Treat magnitudes as ranked guesses until step 0 is done.

## 0. Measure first

- Flex on `gpt-6-luna` is listed at $0.05 in / $0.25 out per MTok (Standard is double). `.env.example` shows the dashboard prices at $0.10 / $0.50, which are the Standard rates. Correct them, then confirm against the real OpenAI usage view for one week.
- At those rates daily text spend is cents. TTS (about $0.13 per fully played day), Jev and Brave can rival it, so quality-risking text trims save little.
- Usage is thinly recorded: `pipeline_run_steps` and `daily_reports` only, as input/output sums. Add `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens` and a per-call row (call site, effort, status). Chat, deepen, weekly jobs and `processAnswer` are not recorded at all.
- `daily_reports.tokens_in/out` leaves out Phase 2. Use `pipeline_run_steps` for the true total, and never sum parent and child displayed totals.
- Cheap first step: read `raw_content.tokensIn/tokensOut` per desk and the `jev_decisions` row counts.

## 1. Meta-run global note accumulation (needs a decision)

`weekly-meta-run.ts` saves up to 8k tokens a week as a `global` note with no expiry. `phase3-context.ts` routes global notes into `notesIntel` and `notesPersonal`, so they reach Section 1, Section 2 and Phase 2 personal classification every day. The news editor and quick actions already filter them out.

Options: expire the note, give it its own scope, or filter it in Sections 1 and 2 like the editor does. Deciding question: should Sections 1 and 2 see meta-run output at all? If not, filter. If yes, expire. Check the size first:
`select count(*), sum(length(content)) from notes where scope='global' and deleted_at is null and content like 'WEEKLY META-RUN%'`

## 2. Reasoning effort

Eleven calls a day run at `high`. Reasoning tokens bill as output.
- Run a week with `NEWS_REASONING_EFFORT=medium` (no code change). It doubles as input to the news tuning week in `docs/todo/`.
- Then try medium on the news editor (a deterministic fallback exists in `src/news/format.ts`), question reconcile and the weekly jobs. The weekly review sends about 100 tokens at `high` with a 12k cap.
- Keep `high` for Sections 1 and 2 and the context-builder document unless a replay shows no loss.
- Lowering `max_output_tokens` alone does not cut a complete answer's bill.
- Judge by replay: missed stories, wrong urgency, refs, action quality. Final desk answers and quick actions carry the highest product risk.

## 3. Jev shadow

It feeds nothing and runs on production since 2026-10-07 at roughly 2 calls per eligible story, up to 3 HTTP attempts each, and the per-call price is not visible in the repo.
- `jev-shadow.ts:69-70` does not apply the gate threshold, so stories scoring 1-2 and below-bar abroad stories still get calls. Add that filter.
- Or unset `JEV_MODE_NEWS_*` to stop it.

## 4. Input trims (moderate effort)

- **News desk evidence.** Round 1 requests `count=20` but shows 12 (`research.ts:625`). Brave context caps are 4096 tokens total and 600 per URL (`brave.ts:219-222`), with 5 snippets per context result and 2 per news result. Try 8 results, fewer snippets and about 2500/400 caps. Drop results matching `recentlyReported` before the model sees them, and dedupe URLs and near-identical snippets across queries. Potential 25-40% of desk input; verify the same stories survive.
- **Plan calls.** Stop sending the full mandate and `desk_input` to query planning (the mandate is paid three times per desk; `already_reported` and interests are useless there). Round-1 queries could be templated from `fallbackQueries`, removing 6 calls a day. Compare against a real front page, since the mandates exist for recall.
- **Reconcile.** Replace the roughly 15k-token `personalSections` with a short digest, skip the call when no new candidates, notes or answers arrived since the last run (input hash), and cap notes (600 chars each, no count limit, `reconcile.ts:151`).
- **Long-term context digests.** Section 1 takes about 9.6k tokens of long-term context and Section 2 about 15k; the document grew from 63k to 98k chars in three weeks. Precompute 2-3k token digests per call type at the monthly build. Beat and field desks send about 6.8k tokens of interests three times each.
- **Personal classification.** Every personal mail or SMS carries the whole contact directory and 30 notes. Send the matching sender, aliases and relevant notes, with a fallback for unknown senders. Measure classification errors. Prefilter OTPs and short-code spam, cap the SMS body, and fix the `Date.now()` dedupe fallback when a forwarder retries without a timestamp.
- **Section 1.** Lower `SECTION1_CAPACITY` (30): the section is capped at 900 words, and 11 of 26 newsletter items on 2026-10-01 were teasers that were paid for and then gated out. Select `active_topics`, entity contexts and notes by relevance to the day's items.
- **Section 2 and quick actions.** Send only the matching contacts and open to-dos, with a safe fallback (quick actions compare against the full task list to avoid duplicates).
- **Weekly prompt review.** Send changed prompt excerpts and specific feedback, not 600 chars of every prompt, and skip quiet weeks.

## 5. Skip empty work

- Section 1 runs with zero items; Section 2 runs with no personal items, questions or calendar change. Define "empty" carefully (calendar, to-dos, standing obligations).
- Skip quick actions when no mail could plausibly create an event or task, keeping an audit path for misses.
- Slot 1 query planning is one LLM call and could be a template, as slots 2 and 3 already are.
- Deterministic promo and empty-mail rules before newsletter extraction, only with a recorded discard reason (false positives hide stories permanently).
- Disable sources that consistently deliver no useful claims (a product decision on recall).

## 6. Context Builder

- Update mode re-summarizes the whole stored corpus: contacts at an 18k cap, Keep at 24k, and the patch at `high` with a 32k cap. Hash the inputs and skip synthesis when nothing changed, reusing the prior summaries. Diff Tasks and GitHub against the last snapshot.
- Drop the patch effort to medium. Try a deterministic heading repair before the 32k full rebuild, and measure how often the rebuild fires.
- Updating only affected sections and assembling the `# 1.` to `# 5.` headings deterministically would cut output further, but it changes the document contract that `pickSections` depends on.
- Force full still re-extracts the entire corpus (about 5-8M input tokens). Reuse stored extractions unless the prompt or schema version changed. The confirm dialog is done; this part is not.
- A permanently failing item is retried every month forever. Record failures with a count and a give-up threshold.
- Smaller trims: cut the body cap from 6000 to 2000-3000 chars, add bulk-mail header fields to the fetch, cap the unsubscribe HTML at 4000 chars.

## 7. Chat, deepen and retries

- **Chat history.** Limits are 60 messages, 40k chars per tool result and 400k chars of tool log: up to about 100k tokens replayed per round, up to 9 rounds. Try about 20 messages and 50k chars of tool log, summarize old turns, expose fewer tool schemas per surface, and add loop detection. The generosity mainly protects Brave re-runs, so keep exact IDs and evidence.
- **Deepen has no cache.** Each click costs a Brave call from the shared 30/day plus a synthesis call. Cache by ids hash with a freshness window.
- **Retry stacking.** The OpenAI client sets no `maxRetries`, so 2 hidden SDK retries sit under `withFlexRetry` (4 attempts), under the incomplete 4x re-run, under step-level `withRetry` x3. Billed failed attempts are not counted. Set `maxRetries: 0` to make the layers explicit. A `withRetry` re-run of Section 1 after a post-model DB failure re-bills the whole `high` call.
- No per-day budget or rate limit exists on any AI endpoint, and chat has no message length cap. The only real guard is the shared Brave quota.

## 8. Brave

The quota is exactly 30/30 with zero headroom and retries count. That is a reliability risk as much as a cost. A failed desk loses its evidence and re-searches, so persist evidence before the final call.

## 9. Pricing mechanisms

- **Prompt caching** needs a 1,024-token prefix minimum, cache reads cost 0.1x and writes 1.25x, and the lifetime is at least 30 minutes, so daily reuse cannot be assumed. The in-run opportunities are Phase 2 per-item calls (static prompt before the account line), the chat tool loop and the desk finals. Measure `cached_tokens` first. Open question: does the chat "Now: HH:MM" clock in the instructions break the prefix?
- **Smaller model.** `OPENAI_MODEL_EXTRACTION` is separate from synthesis, so Phase 2 and desk planning can move by config. GPT-5 Nano Flex is $0.025 / $0.20, a modest gain at these prices; benchmark before switching anything the report depends on.
- **Batch** has the same listed rate as Flex and a 24-hour window, so it is not an extra discount and does not fit the morning report. It would also need a privacy review for personal data.

## 10. Audio

TTS is the one line that is not cents. If briefings are usually played in full, options are a shorter spoken edition (personal section and top news), device speech synthesis, or comparing `tts-1` ($15 per million characters, about $0.117 for the documented 7,777-character day, fewer voices than `cedar`). Measure playback frequency first. Do not change the TTS model or voice casually: it re-speaks every cached day.
