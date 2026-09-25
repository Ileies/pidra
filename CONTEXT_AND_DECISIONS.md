# Morning Briefing System - Context & Decisions v2

> Companion to `MORNING_BRIEFING_PLAN.md`. Every line in this file exists because it affects an implementation decision, a prompt, or a data structure. No biographical detail included unless it changes how the system should behave.

---

## Table of Contents

1. [Builder Profile](#1-builder-profile)
2. [Project History & Prior Art](#2-project-history--prior-art)
3. [Intelligence Priorities (for prompt engineering)](#3-intelligence-priorities-for-prompt-engineering)
4. [Report Format Requirements](#4-report-format-requirements)
5. [Newsletter Selection Rationale (all 32)](#5-newsletter-selection-rationale-all-32)
6. [Google Tasks - Categories & Integration Notes](#6-google-tasks--categories--integration-notes)
7. [Google Keep - Categories & Integration Notes](#7-google-keep--categories--integration-notes)
8. [Email Sender Directory (`contacts`)](#8-email-sender-directory-contacts)
9. [Key Decisions Made](#9-key-decisions-made)
10. [Core Design Principles](#10-core-design-principles)
11. [Content Processing Notes](#11-content-processing-notes)
---

## 1. Builder Profile

> **The profile itself is not gone, it moved.** This repository is public, so identifying
> details live in Postgres instead: `standing_context`, under the `profile_*` keys
> (`profile_identity`, `profile_china`, `profile_company`, `profile_university`,
> `profile_stack`, `profile_family_and_partner`, `profile_language_handling`).
> They are injected into the daily briefing at runtime as `standing_rules`, alongside the
> Context Builder's generated document. See `src/pipeline/long-term-context.ts`.
>
> What follows is only the design rationale, which is safe to publish.

**Role:** Solo developer, working alone across the whole stack.  
**Languages:** Reads sources in several languages, including Chinese - source selection assumes that, so non-English newsletters are in scope.  
**China:** A standing personal and strategic interest rather than a casual geopolitical one. A calendar pre-trip window (2 weeks before any China flight) should trigger boosted China content in the intelligence section.  
**Company:** Planning to found internationally. EU and Swiss regulatory context is professionally relevant, not just interesting.  
**Cognitive style:** Needs high novelty per paragraph, clear section structure, no recap sentences, no padding. Format is functionally important, not aesthetic preference.  
**Stack:** Bun, SvelteKit, Postgres, DrizzleORM, NixOS, OpenAI Responses API and GitHub. Extraction and synthesis models are configurable and both default to `gpt-5.6-luna`. Self-hosts on own server (Netcup, migration possible). All projects solo-built.
**University:** Currently enrolled - 7 active Uni tasks in Google Tasks. Uni emails and deadlines are real priority items for Section 2.

---

## 2. Project History & Prior Art

### Directly relevant to this build

**pidra** *(active - this is the project)* - This is the repository being built. "Personal daily report agent pulling from mail, calendar, GitHub, news, and todos." Planning material from this conversation has already been placed in this repo. All implementation goes here.

**rizinos** *(active)* - Browser-based web OS with accounts, desktop, files, apps, WebSocket services. The SvelteKit dashboard for the briefing system can share design patterns and auth infrastructure with this project. Probably shares the Postgres instance.

**smartworkhub** *(done, ongoing)* - B2B AI platform with agents, chat, files, vector stores, admin, and deployment. Direct experience with LLM integration at production level. Vector store implementation experience is relevant (confirms the decision to *not* use vector stores in this project is deliberate, not naive).

**chatgpt-data-extractor** *(done)* - Small Bun project for processing ChatGPT data. Directly relevant to the chat history signal extraction in Phase 7. The extraction logic likely already exists in some form here.

**adhd-tasker** *(paused)* - 24-hour task planner with focus mode, reminders, calendar view, Google login. Overlaps with the productivity system goals. Relevant for Section 2 task integration patterns.

**rag-store** *(paused)* - RAG/document-store experiment with ChromaDB and OpenAI. Another data point confirming the vector store rejection is experienced, not theoretical.

### Stack confirmation from project history
The full project list confirms deep, production-level experience with: SvelteKit, Bun, Postgres, DrizzleORM, auth (multiple implementations), Stripe, i18n, NixOS deployment, Discord bots (Telegraf), Minecraft plugins (Paper/Kotlin), browser extensions, and LLM integrations. No scaffolding or boilerplate explanations needed.

### Relevant skills the system can eventually call via the local skills bridge
Based on project history, the user has existing scripts and utilities for: NixOS service management (`nixos-mosh-flake`), DNS updates (`netcup-dynamic-ip`), Git operations (`gh-terrain-history`). These are natural candidates for early skill implementations.

---

## 3. Intelligence Priorities (for prompt engineering)

These are ordered. When forced to choose between two stories, rank by this list.

1. **AI/LLM** - breakthroughs, model releases, capability jumps, safety developments, policy changes
2. **China** - geopolitics, US-China dynamics, Chinese tech sector, domestic policy, Sino-Swiss or Sino-German news
3. **European/Swiss startup ecosystem** - VC funding rounds, EU regulation (AI Act, GDPR enforcement, DSA), Swiss-specific business news
4. **Global macro** - interest rates, currency movements, geopolitical crises with tech implications
5. **Neuroscience/BCI** - clinical trials, device approvals, research milestones
6. **Science** - physics, biology, longevity, aging biology, chemistry breakthroughs
7. **Dev/engineering** - major framework releases (especially Bun, SvelteKit, Postgres, NixOS), security events, tooling shifts

**Exclude always:** Celebrity, sports, US domestic politics unrelated to tech or China, promotional content, items with effective relevance < 3.

**Superseded for the News section (2026-09-25):** these exclusions describe the newsletter briefing (Section 1), not the news. The News section includes anything of major public salience whatever its domain (a globally famous person attacked, a war, a disaster in the home city, the match everyone discussed), because the reader relies on it as their only news source and exclusions there are exactly how they end up the last to know. See §9, "News desks".

**Boost automatically:**
- Stories covered by 3+ newsletters (corroboration signal)
- Stories connecting two or more priority domains (cross-domain connections are the highest-value output)
- Stories directly relevant to active projects (RizinOS, morning briefing system, ileies)
- Any development in Switzerland or affecting Swiss residents

---

## 4. Report Format Requirements

These are functional requirements, not style preferences. A high-density reading pattern means:

- **No recap sentences.** "As mentioned above," "as we can see," "this means that" - never.
- **No padding.** Every sentence must introduce something new.
- **Clear hierarchy.** Section headers, urgency levels, "Also noted" - the structure is read before the content.
- **UPDATE: prefix** on continuing stories - signals "don't re-read background, just read the delta."
- **One-liners in "Also noted"** - single-sentence claim statement only. Not a summary.
- **Cross-domain connections made explicit** - if an AI story connects to a China story, state the link directly. Do not leave it implicit.
- **Section 2 urgency labels are load-bearing** - Critical/High/Normal must be correct. An incorrectly labeled urgent item that gets skipped has real consequences.
- **Target length:** Section 1: at most 900 words, and less on a light day. Section 2: 300–500 words. Revised 2026-09-25 from "600–900 regardless of input volume": held on a day with six thin items, the floor is what turned a neurology society's leadership election and an 18th-century book into two-paragraph essays, and the owner had started scrolling past Section 1 altogether. With the News section carrying what happened, Section 1 is the depth layer and is as long as its material. The same revision dropped "go deeper on a light day" and its 2.5 relevance floor, which the gate had already made dead: nothing under 3 reaches synthesis.
- **News section:** one bullet per story, a bold headline sentence and the facts needed to retell it, at most 45 words. No analysis: it is read to know what happened, and the newsletters are where the depth lives.

---

## 5. Newsletter Selection Rationale (all 32)

Tier S = essential daily reads. Tier A = high-value, subscribe immediately. Tier B/C = niche but earns its place.

**S - Astral Codex Ten** (Scott Alexander): Philosophy, psychiatry, AI safety, consciousness. Surgical precision, intellectual courage. Best available philosophy/rationality writing. Mostly free.

**S - The Intrinsic Perspective** (Erik Hoel): Neuroscience, consciousness, identity, emergence. Academic depth, contrarian within the field. Directly feeds BCI and identity philosophy interests.

**S - Exponential View** (Azeem Azhar): AI + economics + geopolitics + energy in one analytical lens. Rare cross-domain synthesis. Free tier.

**S - Import AI** (Jack Clark): Most technically honest AI newsletter. Research papers, capability analysis, safety, policy. Anthropic co-founder. Free.

**S - The Diff** (Byrne Hobart): 1,500-word analytical essays on finance, markets, tech strategy. Maximum density. Free tier 2×/week.

**S - Not Boring** (Packy McCormick): 5,000-word startup strategy deep-dives. Essential for founder education. Free Mon+Thu.

**S - Money Stuff** (Matt Levine): Best financial writer active. 3,000-word daily essays on finance events. High income + founding plans make this essential. Free (Bloomberg signup).

**S - Sinocism** (Bill Bishop): Gold standard China newsletter. The standing China interest makes this professionally critical. Limited free / $20/month - worth it.

**A - The Generalist** (Mario Gabriele): 5,000-word company/sector analyses. Investment-bank research quality.

**A - Farnam Street Brain Food** (Shane Parrish): Mental models and decision frameworks. Weekly free.

**A - Works in Progress**: Long-form essays on science and civilizational progress. Free.

**A - Experimental History** (Adam Mastroianni): Empirical psychology through skeptical lens. Challenges consensus with data.

**A - Noahpinion** (Noah Smith): Heterodox economics. Strong on Asia, industrial policy. 3×/week free tier.

**A - China Brief** (James Palmer, Foreign Policy): Free weekly China digest. Complements Sinocism - different angle.

**A - TLDR AI** (Dan Ni): Best-structured daily AI newsletter for programmatic parsing. Clean section headers. Free.

**A - MIT Tech Review: The Download**: Credentialed science journalism. Covers BCI, AI, medicine without hype. Daily free.

**A - Benedict Evans**: Frameworks for tech displacement cycles. Weekly free.

**A - SemiAnalysis** (Dylan Patel): Deepest AI hardware and semiconductor economics analysis available. Limited free.

**A - Term Sheet** (Dan Primack): Gold standard VC/M&A news. Best sourcing in venture journalism. Daily free.

**A - ChinaTalk** (Jordan Schneider): Chinese AI labs, chip policy, US-China tech decoupling. Fills gap neither Sinocism nor China Brief covers.

**A - Hacker Newsletter** (Kale Davis): Curated best-of Hacker News. Clean format, good for parsing. Weekly free.

**A - Quanta Magazine**: Elite science journalism - math, physics, biology. Does not simplify. Free.

**A - FoundMyFitness** (Rhonda Patrick): Science-first longevity research. Rigorous, no biohacking hype. Free.

**B - PESTLE and MORTAR**: Weekly geopolitical risk. Covers China, semiconductors, AI policy. Free.

**B - What's on Weibo** (Manya Koetse): Chinese internet culture and social discourse in English. Useful for understanding what ordinary Chinese people discuss - relevant for annual China trips.

**B - Interconnected** (Kevin Xu): US-China tech intersection. Decoupling, Chinese AI, international founder implications.

**B - War on the Rocks**: Defense and foreign policy by former practitioners. Covers strategic competition with substance.

**B - Palladium Magazine**: Governance, political theory, civilizational futures. Long-form, serious.

**B - Following the Yuan** (Yaling Jiang): China consumer market and business. Relevant for any Chinese business ambitions.

**B - Console.dev**: Developer tools and open source projects. Weekly curated. Relevant for self-hosting stack.

**B - Bytes.dev** (Tyler McGinnis): JavaScript ecosystem. SvelteKit stack makes this directly work-relevant.

**C - NeuroNews International**: Clinical neuroscience and BCI trials. Keeps the BCI interest frontier-level.

---

## 6. Google Tasks - Categories & Integration Notes

Active task lists and item counts as of planning. Section 2 should reference these lists by name when flagging tasks.

| List | Items | Notes for Section 2 |
|---|---|---|
| **To-Do Now** | 21 | Highest priority. Items here should appear in Section 2 if approaching deadline or referenced by an email. |
| **Work** | 10 | Client and project work. Cross-reference with incoming client emails. |
| **Shopping List** | 8 | Low priority for briefing. Only surface if an email references a purchase or price alert. |
| **To-Do Later** | 18 | Surface only if an email or calendar event makes an item suddenly urgent. |
| **Plans & Goals** | 20 | Medium-term goals. Relevant when intel section contains news that intersects with a goal. |
| **Dreams** | 19 | Long-term aspirations. Rarely relevant to briefing unless a major opportunity arises. |
| **Daily Life Rules** | 13 | **High value.** These are standing personal operating rules. Consider injecting selected rules into the Section 2 system prompt as standing user preferences (e.g., "avoid X," "always do Y"). Ask user to share these rules explicitly - see §12. |
| **To Sort** | 24 | Messy backlog. System should never reference items here without user instruction. |
| **Uni** | 7 | University deadlines and tasks. Treat with same urgency as Work. |
| **RizinOS** | 6 | Project-specific. Cross-reference with RizinOS-related news or GitHub events if tracked. |

**Default list for system-created tasks:** "To-Do Now" (decided 2026-09-10). System items come from email deadlines and are time-sensitive, so they belong in the list that is checked daily, not in a project backlog. Set in code as a list *title* and resolved to an id at call time by `resolveTaskList` (`src/ingest/google.ts`); `GOOGLE_TASKS_DEFAULT_LIST` overrides it without a deploy.

---

## 7. Google Keep - Categories & Integration Notes

User has ~1,000 notes across these categories. The Keep integration (Phase 7) should handle each category differently.

| Category | Value for system | Integration approach |
|---|---|---|
| **Memories** | **High.** "Specific information not to forget." Pre-seed as system notes. May contain contact context, important facts, commitments. | Manual review before Phase 7 - user should identify which memories are relevant to briefing context. High-value ones should be migrated to the system's `notes` table directly. |
| **Favorites** | **High.** Top 5/10 lists across many topics. Contains curated "best of" research - directly relevant to entity importance scoring. If user has a "top AI tools" list, those entities should be marked `importance = high` in entity graph. | Extract entities from all Favorites notes during initial indexing. Boost importance of matched entities. |
| **Shower Ideas** | **Medium.** Project and product ideas, often ahead of their time. Relevant for entity graph (new concepts to track) and for chat signal cross-referencing. | Index as `note_type = "idea"`. Surface matches when intel section covers related technology or market development. |
| **Recommendations** | **Medium.** Products, services, travel destinations. Cross-reference with web search Slot 3 rotation (reputation/research monitoring). | Index entities. Low-priority matches only. |
| **Learning Chinese** | **Low for briefing.** Personal learning notes. | Index for entity extraction (Chinese names, terms) but do not include in active context injection. |
| **Full Travel Plans** | **Medium.** Future travel plans. If a China trip plan exists, extract target dates → set calendar trigger for China content boost. | Parse dates if present. Feed into temporal awareness (§10 of plan). |
| **Thoughts** | **Low-medium.** Personal reflections. May overlap with diary in function. | Index for topic signals only. Do not inject into prompts. |
| **Quotes** | **Low.** Saved quotes. | Index entities (attributed persons). Otherwise low priority. |
| **To-Do** | **Low.** "Mostly old stuff." | User should migrate to Google Tasks. System should not read this as active tasks - flag to user once during setup. |
| **Random** | **Low.** Miscellaneous. | Index for entity extraction. Low injection priority. |
| **Archived** | **Very low.** Historical notes. | Index once, do not refresh. Use only for deep entity lookups. |

---

## 8. Email Sender Directory (`contacts`)

**Decision, 2026-09-10: `contacts` is an email sender directory, not a social graph.**

The first Context Builder run seeded 6 rows from 1432 emails. That was initially read as the
`batch-contacts` threshold being too strict. It is not a threshold problem. The user does not
conduct relationships over email: the inbox is newsletters, `noreply` notifications and a
handful of clients, while the actual social circle lives on Discord, WhatsApp, Instagram,
WeChat, Line, KakaoTalk, VK, Zalo, Facebook, X, Telegram and LinkedIn. Six rows is the correct
answer to the question this table asks, and loosening the heuristic would only admit automated
senders, not people.

So the table answers exactly one question: *mail arrived from this address, who is that and how
much should triage care.* `phase3-context.ts` loads every row unfiltered, and
`phase5-synthesis.ts` hands it to the Section 2 prompt as `known_contacts`.

**No messaging platform will be ingested to fill it.** Closed deliberately, see `CLAUDE.md`
under "What not to build". Personal relationship context is not lost by this: it lives in
`standing_context` under `profile_family_and_partner` and reaches Section 2 through
`long_term_context`, which is where the model is told to resolve senders from anyway.

> **The contact list is not gone, it moved.** This repository is public and the list describes
> third parties, including minors, who have not consented to being published. It now lives in
> Postgres: the relationship context in `standing_context` under `profile_family_and_partner`
> and `profile_language_handling`, and real addresses in the `contacts` table as the Context
> Builder learns them from actual mail. Both reach the briefing at runtime.

The shape of what belongs in `contacts`, one row per sending address:

| Column | Purpose |
|---|---|
| `identifier` | Email address or phone number. Must be an address; the seeding step rejects anything else |
| `name` | Display name, as decoded from the mail header |
| `relationship` | Free text, e.g. "client", "bank", "university", "family" - what the sender is to the user, which drives urgency weighting. Not a social tie |
| `priority` | `critical` / `high` / `normal` - the question gate never fires for a known sender |

Design notes that shaped it, with no personal detail attached:

- **Own addresses** are never classified as an incoming action item. Configured via
  `email-accounts.json` plus `SELF_EMAILS`, never in source.
- **Close family and partners** warrant `critical` or `high` priority so the question gate does
  not interrogate the user about people it should already know.
- **Non-English personal mail is expected.** Personal contacts may write in a language other
  than English, so the Section 2 classification prompt must extract and classify in English
  regardless of source language rather than treating it as unparseable.

---

## 9. Key Decisions Made

### Architecture
- **B + C + D + compounding layer.** Not A (no cross-day memory), not E (newsletters aren't real-time), not F (non-deterministic, hard to debug).
- Compounding layer adds: feedback loops, entity graph, source quality evolution, weekly self-improvement run. This is what makes B+C+D compound instead of just accumulate.

### Newsletter count: 32
Cut from 50. Removed 18 sources due to: pure redundancy (same daily news cycle covered by a retained source), wrong format for LLM parsing (visual/eclectic/reference), or low signal-to-token ratio. Token cost was not a factor - ~$2–3/month at 50.

### AI model selection

Both pipeline stages use the OpenAI Responses API through `src/ai/openai.ts`. `OPENAI_MODEL_EXTRACTION` and `OPENAI_MODEL_SYNTHESIS` select the models; both default to `gpt-5.6-luna`. The two-stage split is architecturally load-bearing, while the configured model identifiers are not.

### GPU: RTX 4090 (24GB VRAM)
Over 4070 Ti Super: future-proofs for 32b models, faster at concurrency 4, server already runs multiple demanding workloads simultaneously.

**Current status:** no current pipeline workload depends on local model hardware. Revisit only if a local execution path is deliberately introduced.

### Delivery: SvelteKit dashboard + PWA + push notification
Push notification says only "Morning briefing ready - N items." No content in notification. Report read in SvelteKit dashboard (browser/desktop) or PWA (mobile).

### To-do: Google Tasks API
### Calendar: Google Calendar API
### Report language: English (always, regardless of source language)
### Web search: Brave Search API only, never OpenAI's `web_search` tool
**Owner's decision, 2026-09-25: every web search in PIDRA goes through the Brave Search API. No OpenAI `web_search` calls, anywhere.** This covers the news desks as well as the Section 1 slots and the `run_web_search` skill, and it supersedes the news-desk bullet below that chose OpenAI's tool. The model still reads and judges, but code runs every search, so every query and every result is in our hands before the model sees it.

Not a rename. The desks were built on a tool that searches, opens pages and judges inside one call; on Brave the loop, the page reading, the budgets and the rate limit are ours to build. Until that build lands the desks still run on `researchJson()` (`TODO.md`, Now), and no new caller of it may be added.

Brave was chosen at the start behind an internal interface (`src/search/brave.ts`), with Tavily or Exa as the fallback if its quality is not good enough.

### News desks: the briefing is the reader's only news source
**Decision, 2026-09-25: the briefing covers the day's news itself, researched on the web every morning.** The owner's words: this app is their only source of news, and at work and at home they are asked whether they live behind the moon. The evidence agreed. The 32 newsletters are slow news by design (essays, research, analysis) and none of them is a general news source; 12 of them, TLDR AI among them, had not delivered a single issue since 2026-09-12; weekends brought one to three items. The briefing of 2026-09-25 spent its Section 1 on a neurology society's leadership election and an 18th-century book, and could not say where the US-China summit was taking place. Nothing in the system could have reported a war, an election or a fire in the home city.

The shape, and why:
- **Six desks, each one web-search call with one mandate** (`src/news/desks.ts`): world front page, home city and country, the reader's first priority as a beat, their other fields, talk of the day, something different. Separate mandates because recall is the failure that matters and a single "find the news" call runs a few searches and stops. The beat desk exists because the fields desk, given all seven priorities, spread four search calls across them on its first real run.
- ~~**OpenAI's `web_search` tool, not Brave.**~~ **Superseded the same day** by the Brave-only decision above. The original reasoning was that a desk has to search, read and judge in one call, and Brave returns snippets; the Brave build has to answer that objection by fetching the pages itself.
- **The model selects, code verifies** (`src/news/validate.ts`): a story is held back when none of its sources is a URL the search returned, when it predates the window, when another desk's copy was kept, or when the reader already saw it and nothing is new. Each has a gate reason, so nothing is dropped silently.
- **Links are never model-written.** The editor cites short ids; code maps them to extraction ids and attaches the links from checked sources, and strips any link the editor wrote.
- **What a desk may see is the privacy boundary.** Its queries go to a search engine, so it gets the home location (`NEWS_HOME_*`, configuration, not the profile text), the interests section of the context document, the intel notes and recent headlines, never the personal sections.
- **Cost, measured on 2026-09-25:** about 26-30 search calls and 250k input tokens a morning with every desk at medium effort, about 77 calls and 670k tokens with every desk at high. The defaults put the four recall-critical desks at high and fields and something-different at medium; `NEWS_REASONING_EFFORT=medium` roughly halves the calls.

### Passive context sources
**Status: none of the three are built yet.** This is Phase 7 of the roadmap (`MORNING_BRIEFING_PLAN.md` §20), deliberately deferred until Phase 6 has run stably for 2+ weeks (`CLAUDE.md`, "What not to build (yet)"). The design below is the plan, not the current state - no `keep_notes`, `keep_index`, `chat_signals`, or `personal_context` table exists yet.
- **Keep notes:** Index via local extraction, query by entity match during Phase 3. Matched summaries only reach synthesis.
- **Chat history:** Nightly local extraction for topic/project signals only. Raw content never reaches the cloud API. Sequenced last of the three (decided 2026-09-10) - Keep and diary are denser signal for less privacy surface.
- **Diary:** Local extraction only. Abstract context block (valence, phase, concern tags) reaches synthesis. Raw diary text never leaves the local server - narrower than it sounds, see §10 below: the *raw diary entries* are the thing that never leaves, not diary-derived content in general.

### Question gate timeout: 45 minutes
Section 1 never waits. Section 2 blocks. After 45 min, Section 2 proceeds with unresolved items flagged.

### Prompt self-evolution: human approval always required
Weekly meta-run generates diff. Never auto-applied. Each change approved/rejected individually.

### Offline mode: mirrored data moves outside the wg0 boundary
**Decision, 2026-09-17: yes, a rolling local mirror is worth the change to the threat model.** Full design in `OFFLINE_PLAN.md`. Today every byte of personal content stays behind the wg0 ACL (`SECURITY_PLAN.md` §0, capability 3), and the dashboard has no login because that ACL is the whole boundary. Offline mode deliberately moves a copy of the briefing archive, the notes, the standing rules and the harvested context document onto the phone's storage, outside that boundary, protected only by the device lock and the OS disk encryption. What keeps this proportionate: raw message bodies (`raw_items.raw_content`) never enter the mirror, only rendered report and extraction output; the window is bounded at `MIRROR_DAYS = 60`; "Clear offline data" is one tap. The mirror is deliberately **not encrypted** - a key the app can use unattended is a key an attacker with the device already has, so it would be ceremony rather than protection. Context corrections, contact edits and anything that writes a report stay online-only regardless (`OFFLINE_PLAN.md` §1).

---

## 10. Core Design Principles

**Extraction is a compressor, not an analyst.** Converts text → structured JSON. Never judges importance, writes prose, or synthesizes across sources. Those responsibilities belong to synthesis exclusively. The two-stage split is the architectural rule; models are configured through the OpenAI model environment variables and default to `gpt-5.6-luna`.

**Synthesis synthesizes, never processes.** Sees only compressed extraction output (~12K tokens), not raw email HTML (~50K tokens). Quality is higher, cost is lower.

**Vector stores rejected for the briefing path.** Cosine similarity thresholds silently drop items. For a daily briefing where completeness matters, explicit structured extraction beats probabilistic retrieval. Revised 2026-09-10: this stays true for the pipeline, but the blanket "never revisiting" does not - a vector store is planned for the far future, for search over the *archive* rather than for deciding what enters a report. Nothing in the current phases may add one.

**No prompt changes without human approval.** System can propose (weekly meta-run). Cannot apply. The user's information diet is too important to delegate to an automated optimization loop.

**Diary content: the rule narrowed on 2026-09-10.** Diary and other intimate personal content are deliberately in scope for the Context Builder under `store: false`; only credentials are hard-filtered before any consumer sees them. The still-unbuilt Phase 7 diary track follows the same boundary: it may use the configured extraction model, while its stored output remains an abstract personal-context block.

**The question gate fires before Section 2 synthesis.** Missing context is identified and resolved before writing, not after. A wrong report is worse than a slightly delayed one.

**Every friction is front-loaded.** Most question gate firings in week 1. Most relevance calibration work in weeks 1–2. After 30 days, daily interaction is: read report, optionally rate a few items, done.

**The system's model of the user after 90 days is more accurate than any config file written on day 1.** Build the feedback loops early. Let them run. Do not over-configure manually.

---

## 11. Content Processing Notes

### Two-tier newsletter processing
Daily sources (TLDR AI, Money Stuff, Term Sheet, MIT Tech Review, The Diff, War on the Rocks, Sinocism, Noahpinion): short extraction pass, focus on claim + entity identification. High volume, short items.

Weekly/irregular sources (Astral Codex Ten, The Intrinsic Perspective, Not Boring, The Generalist, Works in Progress, SemiAnalysis): richer extraction prompt capturing central argument, not just claims. Low volume, long dense items. Add `source_format: "essay"` to the extraction output - synthesis treats essay items with more depth in the report.

### Ongoing stories
The most common failure mode of digest briefings: re-explaining background every day. The `active_topics` table and the `UPDATE:` prefix in the Section 1 prompt solve this. A story running for a week = two sentences: what changed today, what it implies.

### Cross-domain connections
When an AI story connects to a China story, or a market development connects to a personal email, state the connection explicitly. This is the highest-value output the system can produce - higher than any individual well-covered story.

---

*Context document version: 2.1 - synced to actual code state, 2026-09-11*
*Companion to: MORNING_BRIEFING_PLAN.md*
*Build with: Bun + SvelteKit + Postgres + DrizzleORM. AI uses the OpenAI Responses API; extraction and synthesis models are configurable and default to `gpt-5.6-luna`.*
