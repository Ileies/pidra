# Morning Briefing System — Context & Decisions v2

> Companion to `MORNING_BRIEFING_PLAN.md`. Every line in this file exists because it affects an implementation decision, a prompt, or a data structure. No biographical detail included unless it changes how the system should behave.

---

## Table of Contents

1. [Builder Profile](#1-builder-profile)
2. [Project History & Prior Art](#2-project-history--prior-art)
3. [Intelligence Priorities (for prompt engineering)](#3-intelligence-priorities-for-prompt-engineering)
4. [Report Format Requirements](#4-report-format-requirements)
5. [Newsletter Selection Rationale (all 32)](#5-newsletter-selection-rationale-all-32)
6. [Google Tasks — Categories & Integration Notes](#6-google-tasks--categories--integration-notes)
7. [Google Keep — Categories & Integration Notes](#7-google-keep--categories--integration-notes)
8. [Known Contacts (pre-seed for question gate)](#8-known-contacts-pre-seed-for-question-gate)
9. [Key Decisions Made](#9-key-decisions-made)
10. [Core Design Principles](#10-core-design-principles)
11. [Content Processing Notes](#11-content-processing-notes)
---

## 1. Builder Profile

**Role:** Solo developer, 22, German, Zurich.  
**Languages:** German (native), English (fluent), Mandarin Chinese (fluent, self-taught).  
**China:** Annual trips, Chinese girlfriend (Yangyang), deep personal and strategic investment — not casual geopolitical interest. Calendar pre-trip window (2 weeks before any China flight) should trigger boosted China content in intelligence section.  
**Company:** Planning to found internationally. EU and Swiss regulatory context is professionally relevant, not just interesting.  
**Cognitive style:** ADHD. Needs high novelty per paragraph, clear section structure, no recap sentences, no padding. Format is functionally important, not aesthetic preference.  
**Stack:** Bun, SvelteKit, Postgres, DrizzleORM, NixOS, Ollama, Claude API, GitHub. Self-hosts on own server (Netcup, migration possible). All projects solo-built.  
**University:** Currently enrolled — 7 active Uni tasks in Google Tasks. Uni emails and deadlines are real priority items for Section 2.

---

## 2. Project History & Prior Art

### Directly relevant to this build

**pidra** *(active — this is the project)* — This is the repository being built. "Personal daily report agent pulling from mail, calendar, GitHub, news, and todos." Planning material from this conversation has already been placed in this repo. All implementation goes here.

**rizinos** *(active)* — Browser-based web OS with accounts, desktop, files, apps, WebSocket services. The SvelteKit dashboard for the briefing system can share design patterns and auth infrastructure with this project. Probably shares the Postgres instance.

**smartworkhub** *(done, ongoing)* — B2B AI platform with agents, chat, files, vector stores, admin, and deployment. Direct experience with LLM integration at production level. Vector store implementation experience is relevant (confirms the decision to *not* use vector stores in this project is deliberate, not naive).

**chatgpt-data-extractor** *(done)* — Small Bun project for processing ChatGPT data. Directly relevant to the chat history signal extraction in Phase 7. The extraction logic likely already exists in some form here.

**adhd-tasker** *(paused)* — 24-hour task planner with focus mode, reminders, calendar view, Google login. Overlaps with the productivity system goals. Relevant for Section 2 task integration patterns.

**rag-store** *(paused)* — RAG/document-store experiment with ChromaDB and OpenAI. Another data point confirming the vector store rejection is experienced, not theoretical.

### Stack confirmation from project history
The full project list confirms deep, production-level experience with: SvelteKit, Bun, Postgres, DrizzleORM, auth (multiple implementations), Stripe, i18n, NixOS deployment, Discord bots (Telegraf), Minecraft plugins (Paper/Kotlin), browser extensions, and LLM integrations. No scaffolding or boilerplate explanations needed.

### Relevant skills the system can eventually call via Claude Code bridge
Based on project history, the user has existing scripts and utilities for: NixOS service management (`nixos-mosh-flake`), DNS updates (`netcup-dynamic-ip`), Git operations (`gh-terrain-history`). These are natural candidates for early skill implementations.

---

## 3. Intelligence Priorities (for prompt engineering)

These are ordered. When forced to choose between two stories, rank by this list.

1. **AI/LLM** — breakthroughs, model releases, capability jumps, safety developments, policy changes
2. **China** — geopolitics, US-China dynamics, Chinese tech sector, domestic policy, Sino-Swiss or Sino-German news
3. **European/Swiss startup ecosystem** — VC funding rounds, EU regulation (AI Act, GDPR enforcement, DSA), Swiss-specific business news
4. **Global macro** — interest rates, currency movements, geopolitical crises with tech implications
5. **Neuroscience/BCI** — clinical trials, device approvals, research milestones
6. **Science** — physics, biology, longevity, aging biology, chemistry breakthroughs
7. **Dev/engineering** — major framework releases (especially Bun, SvelteKit, Postgres, NixOS), security events, tooling shifts

**Exclude always:** Celebrity, sports, US domestic politics unrelated to tech or China, promotional content, items with effective relevance < 3.

**Boost automatically:**
- Stories covered by 3+ newsletters (corroboration signal)
- Stories connecting two or more priority domains (cross-domain connections are the highest-value output)
- Stories directly relevant to active projects (RizinOS, morning briefing system, ileies)
- Any development in Switzerland or affecting Swiss residents

---

## 4. Report Format Requirements

These are functional requirements, not style preferences. ADHD + high-density reading pattern means:

- **No recap sentences.** "As mentioned above," "as we can see," "this means that" — never.
- **No padding.** Every sentence must introduce something new.
- **Clear hierarchy.** Section headers, urgency levels, "Also noted" — the structure is read before the content.
- **UPDATE: prefix** on continuing stories — signals "don't re-read background, just read the delta."
- **One-liners in "Also noted"** — single-sentence claim statement only. Not a summary.
- **Cross-domain connections made explicit** — if an AI story connects to a China story, state the link directly. Do not leave it implicit.
- **Section 2 urgency labels are load-bearing** — Critical/High/Normal must be correct. An incorrectly labeled urgent item that gets skipped has real consequences.
- **Target length:** Section 1: 600–900 words. Section 2: 300–500 words. Hold these regardless of input volume.

---

## 5. Newsletter Selection Rationale (all 32)

Tier S = essential daily reads. Tier A = high-value, subscribe immediately. Tier B/C = niche but earns its place.

**S — Astral Codex Ten** (Scott Alexander): Philosophy, psychiatry, AI safety, consciousness. Surgical precision, intellectual courage. Best available philosophy/rationality writing. Mostly free.

**S — The Intrinsic Perspective** (Erik Hoel): Neuroscience, consciousness, identity, emergence. Academic depth, contrarian within the field. Directly feeds BCI and identity philosophy interests.

**S — Exponential View** (Azeem Azhar): AI + economics + geopolitics + energy in one analytical lens. Rare cross-domain synthesis. Free tier.

**S — Import AI** (Jack Clark): Most technically honest AI newsletter. Research papers, capability analysis, safety, policy. Anthropic co-founder. Free.

**S — The Diff** (Byrne Hobart): 1,500-word analytical essays on finance, markets, tech strategy. Maximum density. Free tier 2×/week.

**S — Not Boring** (Packy McCormick): 5,000-word startup strategy deep-dives. Essential for founder education. Free Mon+Thu.

**S — Money Stuff** (Matt Levine): Best financial writer active. 3,000-word daily essays on finance events. High income + founding plans make this essential. Free (Bloomberg signup).

**S — Sinocism** (Bill Bishop): Gold standard China newsletter. The annual China trips and Mandarin fluency make this professionally critical. Limited free / $20/month — worth it.

**A — The Generalist** (Mario Gabriele): 5,000-word company/sector analyses. Investment-bank research quality.

**A — Farnam Street Brain Food** (Shane Parrish): Mental models and decision frameworks. Weekly free.

**A — Works in Progress**: Long-form essays on science and civilizational progress. Free.

**A — Experimental History** (Adam Mastroianni): Empirical psychology through skeptical lens. Challenges consensus with data.

**A — Noahpinion** (Noah Smith): Heterodox economics. Strong on Asia, industrial policy. 3×/week free tier.

**A — China Brief** (James Palmer, Foreign Policy): Free weekly China digest. Complements Sinocism — different angle.

**A — TLDR AI** (Dan Ni): Best-structured daily AI newsletter for programmatic parsing. Clean section headers. Free.

**A — MIT Tech Review: The Download**: Credentialed science journalism. Covers BCI, AI, medicine without hype. Daily free.

**A — Benedict Evans**: Frameworks for tech displacement cycles. Weekly free.

**A — SemiAnalysis** (Dylan Patel): Deepest AI hardware and semiconductor economics analysis available. Directly relevant to running Ollama on own server. Limited free.

**A — Term Sheet** (Dan Primack): Gold standard VC/M&A news. Best sourcing in venture journalism. Daily free.

**A — ChinaTalk** (Jordan Schneider): Chinese AI labs, chip policy, US-China tech decoupling. Fills gap neither Sinocism nor China Brief covers.

**A — Hacker Newsletter** (Kale Davis): Curated best-of Hacker News. Clean format, good for parsing. Weekly free.

**A — Quanta Magazine**: Elite science journalism — math, physics, biology. Does not simplify. Free.

**A — FoundMyFitness** (Rhonda Patrick): Science-first longevity research. Rigorous, no biohacking hype. Free.

**B — PESTLE and MORTAR**: Weekly geopolitical risk. Covers China, semiconductors, AI policy. Free.

**B — What's on Weibo** (Manya Koetse): Chinese internet culture and social discourse in English. Useful for understanding what ordinary Chinese people discuss — relevant for annual China trips.

**B — Interconnected** (Kevin Xu): US-China tech intersection. Decoupling, Chinese AI, international founder implications.

**B — War on the Rocks**: Defense and foreign policy by former practitioners. Covers strategic competition with substance.

**B — Palladium Magazine**: Governance, political theory, civilizational futures. Long-form, serious.

**B — Following the Yuan** (Yaling Jiang): China consumer market and business. Relevant for any Chinese business ambitions.

**B — Console.dev**: Developer tools and open source projects. Weekly curated. Relevant for self-hosting stack.

**B — Bytes.dev** (Tyler McGinnis): JavaScript ecosystem. SvelteKit stack makes this directly work-relevant.

**C — NeuroNews International**: Clinical neuroscience and BCI trials. Keeps the BCI interest frontier-level.

---

## 6. Google Tasks — Categories & Integration Notes

Active task lists and item counts as of planning. Section 2 should reference these lists by name when flagging tasks.

| List | Items | Notes for Section 2 |
|---|---|---|
| **To-Do Now** | 21 | Highest priority. Items here should appear in Section 2 if approaching deadline or referenced by an email. |
| **Work** | 10 | Client and project work. Cross-reference with incoming client emails. |
| **Shopping List** | 8 | Low priority for briefing. Only surface if an email references a purchase or price alert. |
| **To-Do Later** | 18 | Surface only if an email or calendar event makes an item suddenly urgent. |
| **Plans & Goals** | 20 | Medium-term goals. Relevant when intel section contains news that intersects with a goal. |
| **Dreams** | 19 | Long-term aspirations. Rarely relevant to briefing unless a major opportunity arises. |
| **Daily Life Rules** | 13 | **High value.** These are standing personal operating rules. Consider injecting selected rules into the Section 2 system prompt as standing user preferences (e.g., "avoid X," "always do Y"). Ask user to share these rules explicitly — see §12. |
| **To Sort** | 24 | Messy backlog. System should never reference items here without user instruction. |
| **Uni** | 7 | University deadlines and tasks. Treat with same urgency as Work. |
| **RizinOS** | 6 | Project-specific. Cross-reference with RizinOS-related news or GitHub events if tracked. |

**Default list for system-created tasks:** Ask user to specify (likely "To-Do Now" or "Work"). See §12.

---

## 7. Google Keep — Categories & Integration Notes

User has ~1,000 notes across these categories. The Keep integration (Phase 7) should handle each category differently.

| Category | Value for system | Integration approach |
|---|---|---|
| **Memories** | **High.** "Specific information not to forget." Pre-seed as system notes. May contain contact context, important facts, commitments. | Manual review before Phase 7 — user should identify which memories are relevant to briefing context. High-value ones should be migrated to the system's `notes` table directly. |
| **Favorites** | **High.** Top 5/10 lists across many topics. Contains curated "best of" research — directly relevant to entity importance scoring. If user has a "top AI tools" list, those entities should be marked `importance = high` in entity graph. | Extract entities from all Favorites notes during initial indexing. Boost importance of matched entities. |
| **Shower Ideas** | **Medium.** Project and product ideas, often ahead of their time. Relevant for entity graph (new concepts to track) and for chat signal cross-referencing. | Index as `note_type = "idea"`. Surface matches when intel section covers related technology or market development. |
| **Recommendations** | **Medium.** Products, services, travel destinations. Cross-reference with web search Slot 3 rotation (reputation/research monitoring). | Index entities. Low-priority matches only. |
| **Learning Chinese** | **Low for briefing.** Personal learning notes. | Index for entity extraction (Chinese names, terms) but do not include in active context injection. |
| **Full Travel Plans** | **Medium.** Future travel plans. If a China trip plan exists, extract target dates → set calendar trigger for China content boost. | Parse dates if present. Feed into temporal awareness (§10 of plan). |
| **Thoughts** | **Low-medium.** Personal reflections. May overlap with diary in function. | Index for topic signals only. Do not inject into prompts. |
| **Quotes** | **Low.** Saved quotes. | Index entities (attributed persons). Otherwise low priority. |
| **To-Do** | **Low.** "Mostly old stuff." | User should migrate to Google Tasks. System should not read this as active tasks — flag to user once during setup. |
| **Random** | **Low.** Miscellaneous. | Index for entity extraction. Low injection priority. |
| **Archived** | **Very low.** Historical notes. | Index once, do not refresh. Use only for deep entity lookups. |

---

## 8. Known Contacts (pre-seed for question gate)

Pre-seeding these contacts eliminates question gate firings for known family and relationship contacts on day one.

| Identifier | Name | Relationship | Priority | Notes |
|---|---|---|---|---|
| (user's own email addresses) | Self | Owner | — | Never classify as incoming action item |
| Yangyang | Girlfriend | Partner, Chinese, ENFJ | critical | Chinese national; may send messages in Chinese |
| Father | Father | Family, ISTJ | high | Born 1981; likely practical/logistical emails |
| Mother | Mother | Family, ESFJ | high | Born 1984; likely social/family coordination emails |
| Amelia | Sister | Family, ISFJ | normal | Born 2005 |
| Joel | Brother | Family, ESFP | normal | Born 2009 |
| Rosi | Sister | Family, INFJ | normal | Born 2011 |
| Ava | Sister | Family, INFP | normal | Born 2013 |
| Jai | Brother | Family, ESFP | normal | Born 2016 |

**Note:** Actual email addresses and phone numbers for family members should be added before running the system. The table above provides names and relationship context; identifiers (email/phone) must be filled in during setup.

**Girlfriend language note:** Yangyang may communicate in Chinese. Ollama (qwen2.5:14b) handles Chinese input. Ensure Section 2 classification prompt explicitly handles non-English personal emails — extract and classify in English regardless of source language.

---

## 9. Key Decisions Made

### Architecture
- **B + C + D + compounding layer.** Not A (no cross-day memory), not E (newsletters aren't real-time), not F (non-deterministic, hard to debug).
- Compounding layer adds: feedback loops, entity graph, source quality evolution, weekly self-improvement run. This is what makes B+C+D compound instead of just accumulate.

### Newsletter count: 32
Cut from 50. Removed 18 sources due to: pure redundancy (same daily news cycle covered by a retained source), wrong format for LLM parsing (visual/eclectic/reference), or low signal-to-token ratio. Token cost was not a factor — ~$2–3/month at 50.

### Ollama model: qwen2.5:14b
Over llama3.1:8b: better multilingual (German emails, Chinese messages), stronger structured JSON extraction, better edge-case reasoning. Quantization: Q4_K_M (~8.5GB VRAM). Fallback to 8b if needed.

### GPU: RTX 4090 (24GB VRAM)
Over 4070 Ti Super: future-proofs for 32b models, faster at concurrency 4, server already runs multiple demanding workloads simultaneously.

### Delivery: SvelteKit dashboard + PWA + push notification
Push notification says only "Morning briefing ready — N items." No content in notification. Report read in SvelteKit dashboard (browser/desktop) or PWA (mobile).

### To-do: Google Tasks API
### Calendar: Google Calendar API
### Report language: English (always, regardless of source language)
### Web search: Start with Brave Search API (free tier, 2,000 calls/month)
Abstracted behind internal interface. Evaluate Tavily or Exa after 30 days if quality insufficient.

### Passive context sources
- **Keep notes:** Index via Ollama, query by entity match during Phase 3. Matched summaries only reach Sonnet.
- **Chat history:** Nightly Ollama extraction for topic/project signals only. Raw content never reaches Sonnet.
- **Diary:** Ollama-only. Abstract context block (valence, phase, concern tags) reaches Sonnet. Raw diary text never leaves local server. Hard rule, not preference.

### Question gate timeout: 45 minutes
Section 1 never waits. Section 2 blocks. After 45 min, Section 2 proceeds with unresolved items flagged.

### Prompt self-evolution: human approval always required
Weekly meta-run generates diff. Never auto-applied. Each change approved/rejected individually.

---

## 10. Core Design Principles

**Ollama is a compressor, not an analyst.** Converts text → structured JSON. Never judges importance, writes prose, or synthesizes across sources. Those responsibilities belong to Sonnet exclusively.

**Sonnet synthesizes, never processes.** Sees only compressed Ollama output (~12K tokens), not raw email HTML (~50K tokens). Quality is higher, cost is lower.

**Vector stores rejected categorically.** Cosine similarity thresholds silently drop items. For a daily briefing where completeness matters, explicit structured extraction beats probabilistic retrieval. Not revisiting this decision.

**No prompt changes without human approval.** System can propose (weekly meta-run). Cannot apply. The user's information diet is too important to delegate to an automated optimization loop.

**Diary content never reaches a cloud API.** Enforced at the code level — the diary reader must have no path to any Sonnet API call. Not configurable.

**The question gate fires before Section 2 synthesis.** Missing context is identified and resolved before writing, not after. A wrong report is worse than a slightly delayed one.

**Every friction is front-loaded.** Most question gate firings in week 1. Most relevance calibration work in weeks 1–2. After 30 days, daily interaction is: read report, optionally rate a few items, done.

**The system's model of the user after 90 days is more accurate than any config file written on day 1.** Build the feedback loops early. Let them run. Do not over-configure manually.

---

## 11. Content Processing Notes

### Two-tier newsletter processing
Daily sources (TLDR AI, Money Stuff, Term Sheet, MIT Tech Review, The Diff, War on the Rocks, Sinocism, Noahpinion): short Ollama extraction, focus on claim + entity identification. High volume, short items.

Weekly/irregular sources (Astral Codex Ten, The Intrinsic Perspective, Not Boring, The Generalist, Works in Progress, SemiAnalysis): richer extraction prompt capturing central argument, not just claims. Low volume, long dense items. Add `source_format: "essay"` to Ollama output — Sonnet treats essay items with more depth in the report.

### Ongoing stories
The most common failure mode of digest briefings: re-explaining background every day. The `active_topics` table and the `UPDATE:` prefix in the Section 1 prompt solve this. A story running for a week = two sentences: what changed today, what it implies.

### Cross-domain connections
When an AI story connects to a China story, or a market development connects to a personal email, state the connection explicitly. This is the highest-value output the system can produce — higher than any individual well-covered story.

---

*Context document version: 2.0*
*Companion to: MORNING_BRIEFING_PLAN.md*
*Build with: Bun + SvelteKit + Postgres + DrizzleORM + Ollama (qwen2.5:14b) + Claude Sonnet 4.6*
