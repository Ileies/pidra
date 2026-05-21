# Morning Briefing System - Complete Build Plan

> AI-powered daily intelligence tool. Ingests 32 newsletters, personal emails, SMS, calendar, and to-do list. Produces a structured two-section report every morning. Gets smarter every day through compounding feedback loops, an entity knowledge graph, and weekly self-improvement runs.

---

## Table of Contents

2. [Project Goals](#2-project-goals)
3. [Hardware](#3-hardware)
4. [Technology Stack](#4-technology-stack)
5. [Newsletter Sources (32)](#5-newsletter-sources-32)
6. [System Architecture Overview](#6-system-architecture-overview)
7. [Full Daily Pipeline](#7-full-daily-pipeline)
8. [Database Schema](#8-database-schema)
9. [Ollama Pre-processing Layer](#9-ollama-pre-processing-layer)
10. [Context & Memory Management](#10-context--memory-management)
11. [Entity Knowledge Graph](#11-entity-knowledge-graph)
12. [Source Quality Evolution](#12-source-quality-evolution)
13. [Feedback & Calibration Loops](#13-feedback--calibration-loops)
14. [Weekly Self-Improvement Run](#14-weekly-self-improvement-run)
15. [Web Search Module](#15-web-search-module)
16. [Question Gate](#16-question-gate)
17. [Synthesis Prompts](#17-synthesis-prompts)
18. [Claude Code API Bridge (Skills System)](#18-claude-code-api-bridge-skills-system)
19. [External Integrations](#19-external-integrations)
20. [Delivery Layer](#20-delivery-layer)
21. [Token Cost Analysis](#21-token-cost-analysis)

---

## 2. Project Goals

**Primary goal:** Replace the need to manually check email and do daily news research. One morning report handles both completely.

**Two output sections:**

**Section 1 - Intelligence Briefing**
World-facing intelligence: everything the user couldn't know without active research. Organized by topic domain, not by source. Cross-referenced with previous reports. Never re-introduces known stories - only updates and novel developments.

**Section 2 - Personal Action Center**
Life logistics: emails requiring response, payment deadlines, invitations, upcoming calendar events with context, tasks approaching due date, SMS requiring follow-up. Prioritized by urgency. Cross-linked with calendar and to-do list to avoid duplication.

**System behavior over time:**
- Becomes more relevant as it learns user's actual information diet
- Builds a knowledge graph of all named entities and relationships
- Evolves its own extraction prompts via weekly self-improvement run
- Learns which newsletters are high-signal vs. noise
- Stops asking repeated questions as the contacts table fills

---

## 3. Hardware

**Recommended GPU for Ollama:** NVIDIA RTX 4090 (24GB VRAM)
- Runs qwen2.5:14b (primary model) fully in VRAM at concurrency 4 with significant headroom
- 24GB enables future upgrade to 32b models without hardware change
- Faster inference than 4070 Ti Super, relevant when processing 50+ items in parallel
- Server already runs Minecraft + AI models - the 4090 avoids resource contention

**Fallback:** RTX 4070 Ti Super (16GB VRAM) - fits 14b model, less future-proof

**RAM:** 32GB minimum system RAM recommended for NixOS + Postgres + Bun + Ollama concurrent operation

---

## 4. Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Frontend | SvelteKit (dashboard + PWA) |
| Local AI | Ollama - qwen2.5:14b (primary), llama3.1:8b (fallback) |
| Cloud AI | Claude Sonnet 4.6 (synthesis) |
| Database | Postgres + DrizzleORM |
| Email ingestion | IMAP (Netcup server) |
| SMS ingestion | Android SMS forwarding service → webhook endpoint |
| Calendar | Google Calendar API |
| To-do | Google Tasks API |
| Web search | **TODO - see §23** |
| Push notifications | Web Push API (PWA) |
| Scheduling | Bun cron (built-in) |
| Skill execution | Custom REST API → Claude Code bridge |
| OS | NixOS |

---

## 5. Newsletter Sources (32)

All English unless noted. Ranked by signal quality for this user's profile.

| # | Name | Author | Domain | Cadence | Free tier | URL |
|---|---|---|---|---|---|---|
| 1 | Astral Codex Ten | Scott Alexander | Philosophy/AI | Weekly | Mostly free | astralcodexten.com |
| 2 | The Intrinsic Perspective | Erik Hoel | Neuroscience/Philosophy | Weekly | Free tier | erikhoel.com |
| 3 | Exponential View | Azeem Azhar | AI + Geopolitics | Weekly | Free tier | exponentialview.co |
| 4 | Import AI | Jack Clark | AI Research | Weekly | Free | importai.substack.com |
| 5 | The Diff | Byrne Hobart | Finance + Tech | 5×/week | Free tier (2×) | thediff.co |
| 6 | Not Boring | Packy McCormick | Startups | Mon + Thu | Free | notboring.co |
| 7 | Money Stuff | Matt Levine | Finance | Daily | Free (Bloomberg signup) | bloomberg.com |
| 8 | Sinocism | Bill Bishop | China | 4×/week | Limited free | sinocism.com |
| 9 | The Generalist | Mario Gabriele | Startups | Weekly | Free tier | generalist.com |
| 10 | Farnam Street Brain Food | Shane Parrish | Mental Models | Weekly | Free | fs.blog/newsletter |
| 11 | Works in Progress | Various | Science/Progress | Irregular | Free | worksinprogress.news |
| 12 | Experimental History | Adam Mastroianni | Psychology | Irregular | Free | experimental-history.com |
| 13 | Noahpinion | Noah Smith | Economics | 3×/week | Free tier | noahpinion.substack.com |
| 14 | China Brief | James Palmer | China | Weekly | Free | foreignpolicy.com/newsletters |
| 15 | TLDR AI | Dan Ni | AI | Daily | Free | tldr.tech/ai |
| 16 | MIT Technology Review: The Download | MIT Tech Review | Science/Tech | Daily | Free | technologyreview.com/newsletters |
| 17 | Benedict Evans | Benedict Evans | Tech Strategy | Weekly | Free | ben-evans.com/newsletter |
| 18 | SemiAnalysis | Dylan Patel | AI Infrastructure | Irregular | Limited free | semianalysis.com |
| 19 | Term Sheet | Dan Primack | VC | Daily | Free | fortune.com/newsletters/term-sheet |
| 20 | ChinaTalk | Jordan Schneider | China + Tech | Irregular | Free tier | chinatalk.media |
| 21 | Hacker Newsletter | Kale Davis | Dev | Weekly | Free | hackernewsletter.com |
| 22 | Quanta Magazine | Quanta | Science | Weekly | Free | quantamagazine.org/newsletter |
| 23 | FoundMyFitness | Rhonda Patrick | Longevity | Irregular | Free | foundmyfitness.com/newsletter |
| 24 | PESTLE and MORTAR | Insight Forward | Geopolitics | Weekly | Free | insightforward.co.uk |
| 25 | What's on Weibo | Manya Koetse | China Social | Irregular | Free | whatsonweibo.com |
| 26 | Interconnected | Kevin Xu | China + Tech | Irregular | Free | interconnect.substack.com |
| 27 | War on the Rocks | Various | Security/FP | Daily | Free | warontherocks.com |
| 28 | Palladium Magazine | Various | Political Philosophy | Irregular | Free | palladiummag.com/newsletter |
| 29 | Following the Yuan | Yaling Jiang | China Business | Irregular | Free | followingtheyuan.substack.com |
| 30 | Console.dev | Console | Dev Tools | Weekly | Free | console.dev |
| 31 | Bytes.dev | Tyler McGinnis | JavaScript | Weekly | Free | bytes.dev |
| 32 | NeuroNews International | Various | Neuroscience/BCI | Weekly | Free | neuronewsinternational.com |

**Monthly volume estimate:** ~350–400 emails/month across all 32 sources.

**Netzpolitik.org** (German, digital politics/EU regulation) - keep subscribed for personal reading; evaluate for inclusion in briefing after 30 days of operation.

---

## 6. System Architecture Overview

This system combines three architectural paradigms:

**Architecture B - Map-Reduce Processing Spine**
Every item (newsletter, email, SMS) is independently extracted by Ollama into structured JSON, stored in Postgres, then reduced into a synthesis payload for Sonnet. Parallelized via `Promise.allSettled` with concurrency limiting.

**Architecture C - Structured Memory Layer**
All continuity is achieved through explicit Postgres tables (active topics, entity graph, source quality, prompt versions) - no vector stores, no probabilistic retrieval. Keyword-based novelty scoring. RSS feeds used where available as a cleaner alternative to email HTML.

**Architecture D - Topic-Graph Output**
Section 1 is organized by topic domain, not by source. The entity knowledge graph enriches synthesis with relationship context. Cross-source corroboration scores determine story priority.

**Compounding Intelligence Layer** (on top of B+C+D)
Three feedback loops (implicit behavioral, explicit ratings, weekly review), source quality evolution via trust scores, entity graph growth via daily extraction, and a weekly meta-run that proposes prompt improvements for human approval.

---

## 7. Full Daily Pipeline

**Trigger:** Bun cron at configurable time (default: 06:30 local)

### Phase 1 - Parallel Ingestion (T+0s)
All sources fetched simultaneously via `Promise.allSettled`. Failures are isolated and logged; they do not block other sources.

```
IMAP poll (newsletters + personal emails)
  || SMS webhook receiver
  || Google Calendar API (next 7 days)
  || Google Tasks API (all active tasks)
  || Notes store read (Postgres)
  || Previous report summaries read (last 14 days)
  || Active topics read
```

Raw items written to `raw_items` table. Items already seen (by Message-ID) are skipped.

**RSS supplement:** For newsletters that publish RSS feeds, poll RSS in parallel with IMAP. RSS content is cleaner (no HTML footers, unsubscribe links). Use RSS when available, IMAP as fallback.

### Phase 2 - Ollama Extraction (T+8s, parallel, concurrency: 4)
Two Ollama calls per newsletter email:
1. **Content extraction** → claims, topics, entities, relevance score (see §9)
2. **Entity extraction** → named entities and relationships for the knowledge graph

One Ollama call per personal email/SMS:
- Classification, urgency, action, deadline, unknown_context flag

All calls fire in parallel, limited to 4 concurrent. At ~2s per call, 52 items finish in ~26s wall time.

Failed Ollama calls fall back to passing raw stripped content directly to Sonnet with a `ollama_failed: true` flag.

### Phase 3 - Context Assembly + Web Search (T+12s, parallel with Phase 2)
While Ollama runs, simultaneously:
- Query `active_topics` (status = active, last 14 days)
- Query `entity_graph` for entities mentioned in today's extractions
- Query `source_quality` for all 32 sources
- Query `notes` (all non-expired)
- Query `contacts` (all known) - pre-seeded from day 1 by Context Builder
- Query `standing_context` (type = rule | preference) - pre-seeded by Context Builder from Keep "Daily Life Rules"; injected into Section 2 system prompt
- Compute novelty flags: keyword match between today's extraction topic_tags and active topic headlines
- Compute corroboration: group items by entity overlap, count sources per story
- Fire 3 web search slots (see §15)
- Compute volume signal: count items with effective relevance ≥ 3

### Phase 4 - Question Gate (T+42s, conditional)
If any item has `unknown_context: true`:
- Batch all questions into a single POST to the question API
- Section 1 synthesis begins immediately (unblocked)
- Section 2 synthesis blocks until answers received or 45-minute timeout

### Phase 5 - Sonnet Synthesis (T+42s for S1, T+answer for S2)
Two separate Sonnet 4.6 calls (see §17 for full prompts).
- **Call A** (Section 1): ~8–10K tokens in, ~1,200 tokens out, ~15–20s
- **Call B** (Section 2): ~6–8K tokens in, ~800 tokens out, ~12–15s

Both calls use the current prompt version from `prompt_versions` table.

### Phase 6 - Output & Memory Writes (T+140s, async)
- Merge Section 1 and Section 2 into final report (Markdown)
- Deliver via SvelteKit dashboard + PWA push notification (see §20)
- Write to `daily_reports` (full report + short_summary)
- Update `active_topics`: close resolved stories, add new ones, update running_summaries
- Update `entity_graph`: upsert new entities and relations from Phase 2 extractions
- Increment `source_quality` metrics per source
- Update `contacts` if question answers introduced new context
- Write any new notes (e.g., "User confirmed X is a client")
- Optionally POST tasks to Claude Code bridge if report identifies actionable dev work

**Total wall time:** ~2–3 min (no question gate) | ~4–8 min (gate answered promptly)

---

## 8. Database Schema

All tables managed with DrizzleORM. Database: Postgres on self-hosted Netcup/NixOS server.

### `raw_items`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
run_date        date NOT NULL
source_type     text NOT NULL  -- newsletter | personal_email | sms | calendar | todo
source_name     text           -- newsletter name or sender address
message_id      text UNIQUE    -- email Message-ID for dedup
raw_content     text           -- stripped HTML, no images or footers
received_at     timestamptz
created_at      timestamptz DEFAULT now()
```

### `extractions`
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
raw_item_id         uuid REFERENCES raw_items(id)
run_date            date NOT NULL
extracted_json      jsonb          -- full Ollama output
relevance_score     int            -- 1–5, from Ollama
effective_relevance float          -- relevance_score × source trust_score + corroboration bonus
novelty             text           -- new | continuation | repeat
unknown_context     boolean DEFAULT false
question_for_user   text
included_in_report  boolean DEFAULT false
revealed_relevance  int            -- set by feedback loop (1–5)
ollama_failed       boolean DEFAULT false
created_at          timestamptz DEFAULT now()
```

### `active_topics`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
headline        text NOT NULL           -- canonical story title
domain          text NOT NULL           -- AI | China | Finance | Geopolitics | Science | etc.
running_summary text                    -- 2–3 sentences, current state. Updated after each report.
first_seen      date NOT NULL
last_updated    date NOT NULL
status          text DEFAULT 'active'   -- active | dormant | resolved
update_count    int DEFAULT 1
sources         text[]                  -- which newsletters have covered this
entity_ids      uuid[]                  -- linked entities in knowledge graph
```

### `daily_reports`
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
report_date         date UNIQUE NOT NULL
full_report         text                -- final Markdown output
short_summary       text                -- ~150 tokens, used for context retrieval
item_count          int
items_included      int
items_filtered      int
sonnet_tokens_in    int
sonnet_tokens_out   int
ollama_calls        int
web_searches_run    int
question_gate_fired boolean DEFAULT false
created_at          timestamptz DEFAULT now()
```

### `entities`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
name            text NOT NULL
aliases         text[]
type            text            -- person | org | tech | law | event | concept | place
domain          text            -- primary domain
summary         text            -- 1–2 sentence description, updated over time
first_seen      date
last_mentioned  date
mention_count   int DEFAULT 1
status          text DEFAULT 'active'   -- active | dormant (14+ days absent)
importance      text DEFAULT 'normal'   -- high | normal | low (set by feedback)
```

### `entity_relations`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
from_id         uuid REFERENCES entities(id)
to_id           uuid REFERENCES entities(id)
relation_type   text    -- competes_with | heads | regulates | partners_with | acquired | enables | threatens | funds
confidence      float   -- 0.0–1.0
first_seen      date
last_seen       date
confirmed       boolean DEFAULT false   -- true after multiple independent confirmations
```

### `entity_appearances`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
entity_id       uuid REFERENCES entities(id)
report_date     date
context_snippet text    -- 1–2 sentence context from that day's report
relevance_score int     -- how prominently it featured
```

### `source_quality`
```sql
source_name             text PRIMARY KEY
trust_score             float DEFAULT 1.0   -- multiplier 0.5–2.0
include_rate_30d        float               -- % items included over 30 days
avg_revealed_relevance  float               -- from feedback signals
quality_trend           text DEFAULT 'stable'  -- improving | stable | declining
last_quality_shift      date
promotional_rate_30d    float               -- % items flagged promotional/repeat
notes                   text
updated_at              timestamptz DEFAULT now()
```

### `contacts`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
identifier      text UNIQUE NOT NULL    -- email address or phone number
name            text
relationship    text                    -- from question gate answers
priority        text DEFAULT 'normal'  -- critical | high | normal | low
context_notes   text
first_seen      date DEFAULT CURRENT_DATE
updated_at      timestamptz DEFAULT now()
```

### `notes`
```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
content     text NOT NULL
scope       text NOT NULL   -- global | intel | personal | contact | search
created_at  timestamptz DEFAULT now()
expires_at  date            -- null = permanent
created_by  text DEFAULT 'system'   -- system | user
```

### `prompt_versions`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
version         int NOT NULL
section         text NOT NULL       -- section1 | section2 | ollama_extraction | ollama_entity
prompt_text     text NOT NULL
active          boolean DEFAULT false
change_summary  text                -- what changed and why
approved_at     timestamptz
created_at      timestamptz DEFAULT now()
```

### `feedback_events`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
extraction_id   uuid REFERENCES extractions(id)
event_type      text    -- downstream_action | explicit_plus | explicit_minus | weekly_review
signal_value    int     -- revealed relevance contribution
created_at      timestamptz DEFAULT now()
```

### `skill_executions`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
run_date        date
skill_name      text
parameters      jsonb
status          text    -- pending | approved | executed | rejected | failed
result          text
triggered_by    text    -- report_section | question_gate | manual
created_at      timestamptz DEFAULT now()
```

---

## 9. Ollama Pre-processing Layer

### Model
**Primary:** `qwen2.5:14b` (Q4_K_M quantization, ~8.5GB VRAM)
- Best multilingual ability (German emails, potential Chinese sources)
- Strong structured JSON extraction
- Better edge-case reasoning than 8b models

**Fallback:** `llama3.1:8b` if 14b is unavailable or too slow

### Core principle
Ollama is a **lossless compressor**, not an analyst. Its job: convert text → structured JSON. Never ask it to judge importance, write summaries, or synthesize across sources. Those decisions belong to Sonnet.

### Concurrency
- Default: 4 concurrent Ollama calls
- Adjust based on observed GPU memory pressure
- Use a simple semaphore in Bun: `Promise.allSettled` with a queue

### Newsletter Extraction Prompt
```
You are a structured data extractor. Read the newsletter email below and return ONLY valid JSON. No preamble, no markdown, no explanation.

{
  "source": "newsletter name inferred from content",
  "date": "ISO date from email headers",
  "items": [
    {
      "headline": "one sentence, max 15 words",
      "topic_tags": ["tag1", "tag2"],
      "key_claim": "the specific claim or finding, 2 sentences max",
      "entities": ["named persons, orgs, technologies, places, laws"],
      "novelty": "new",
      "relevance_score": 3
    }
  ],
  "skip_reason": null
}

Rules:
- relevance_score 1–5: 5 = major breakthrough or directly actionable, 3 = interesting development, 1 = routine/low signal
- novelty: always "new" at this stage (continuation/repeat determined downstream)
- If the entire email is promotional, automated notification, or has no informational content, set items:[] and skip_reason:"promotional"
- Extract every distinct claim as a separate item, even if there are 10+
- topic_tags must be from: AI, China, Geopolitics, Finance, Science, BCI, Dev, Health, Startups, VC, EU, Switzerland, Energy, Philosophy, Security

EMAIL CONTENT:
{{stripped_email_content}}
```

### Entity Extraction Prompt (second pass, same Ollama call batched)
```
Extract named entities and relationships from the text below. Return ONLY valid JSON.

{
  "entities": [
    {
      "name": "canonical name",
      "aliases": ["alt names"],
      "type": "person|org|tech|law|event|concept|place",
      "domain": "primary domain"
    }
  ],
  "relations": [
    {
      "from": "entity name",
      "to": "entity name",
      "type": "competes_with|heads|regulates|partners_with|acquired|enables|threatens|funds",
      "confidence": 0.85
    }
  ]
}

Only include relations with confidence ≥ 0.7. Only named entities - no generic terms.

TEXT:
{{stripped_email_content}}
```

### Personal Email Classification Prompt
```
Classify this email. Return ONLY valid JSON.

{
  "type": "invoice|invitation|reply_needed|automated|spam|personal|legal|unknown",
  "urgency": "critical|high|normal|low",
  "deadline": "ISO date or null",
  "action_required": "one sentence describing required action, or null",
  "unknown_context": true/false,
  "question_for_user": "specific question about missing context, or null",
  "sender_known": true/false,
  "calendar_event_suggested": true/false,
  "todo_suggested": true/false
}

Rules:
- unknown_context = true if sender is unknown AND content suggests a relationship (not spam)
- critical = response or action needed within 24h
- invoice from unknown sender always = unknown_context true

EMAIL:
From: {{sender}}
Subject: {{subject}}
{{stripped_content}}
```

### What Ollama does NOT do
- Write prose or summaries
- Judge geopolitical significance
- Decide what matters most today
- Synthesize across multiple sources
- Make any judgment that requires world knowledge beyond extraction

---

## 10. Context & Memory Management

### Novelty scoring (Bun, no AI)
After Ollama extraction, before synthesis:
1. For each extracted item, extract topic_tags and entity names
2. Query `active_topics` for keyword overlap (headline, domain tags)
3. If overlap found → set `novelty = "continuation"`, link to topic_id
4. If entity appears in active topic → inherit that topic's context
5. Duplicate detection: if same headline-level story appears in 3+ sources → flag as corroborated, set `corroboration_count`

### Effective relevance calculation
```
effective_relevance = (ollama_relevance_score × source_trust_score) + corroboration_bonus

corroboration_bonus:
  1 source   = 0
  2 sources  = +0.3
  3 sources  = +0.7
  4+ sources = +1.0

Inclusion threshold: effective_relevance >= 3.0
```

### Volume normalization
Compute `volume_signal` before synthesis:
```
high_relevance_count = count of items with effective_relevance >= 3

volume_signal:
  < 10 items  → "light"   (go deeper, include relevance 2.5+)
  10–25 items → "normal"
  > 25 items  → "heavy"   (top 20 only by effective_relevance, "also noted" section for rest)
```

### Active topics lifecycle
- **New story:** Sonnet creates a new active topic entry in Phase 6 output
- **Continuation:** `update_count++`, `running_summary` rewritten by Sonnet, `last_updated` = today
- **Dormant:** if `last_updated` > 14 days, status = "dormant" (still triggers web search alert, not in main context payload)
- **Resolved:** manually or when Sonnet marks a story concluded. status = "resolved", excluded from context
- **Pruning:** resolved stories older than 60 days → archived. Dormant stories older than 30 days with `update_count < 3` → deleted

### Context payload for Sonnet (what gets sent)
The following is assembled into a structured JSON object before each Sonnet call:

**Section 1 payload:**
```json
{
  "user_profile": "...(compact 200-token profile, see §17)",
  "volume_signal": "normal",
  "high_relevance_count": 18,
  "active_topics": [...],
  "todays_items": [...filtered, novelty-scored extractions...],
  "entity_contexts": [...relevant entity graph nodes with summaries...],
  "web_search_results": [...],
  "notes_intel": [...active intel-scope notes...]
}
```

**Section 2 payload:**
```json
{
  "user_profile": "...",
  "personal_items": [...classified personal emails/SMS...],
  "question_answers": [...or null...],
  "calendar_next_7_days": [...],
  "active_todos": [...],
  "known_contacts": [...relevant entries...],
  "notes_personal": [...personal-scope notes...]
}
```

---

## 11. Entity Knowledge Graph

### Purpose
Every named entity appearing in any report becomes a node. Edges capture relationships. By day 90+, when a new item mentions any known entity, the synthesis payload is automatically enriched with relationship context - Sonnet doesn't need to infer who or what things are.

### Growth trajectory
| Day | ~Entities | ~Relations | Capability |
|---|---|---|---|
| 7 | 150 | 80 | Entity context injection begins |
| 30 | 600 | 400 | Relationship surfacing reliable |
| 90 | 1,800 | 1,400 | Dormant entity alerts accurate |
| 180 | 3,500 | 3,000 | Non-obvious cross-domain connections |

### Entity context injection
When an entity with `mention_count >= 3` appears in today's extractions, inject a context block into the Sonnet payload:
```
[Entity context: OpenAI - AI lab, heads Sam Altman. Competes with: Anthropic, Google DeepMind. Recent: GPT-5 release controversy (active topic #12).]
```

### Dormant entity alerts
If an entity has:
- `importance = high` (set by feedback or mention_count > 15)
- `status = dormant` (last_mentioned > 14 days)
- Does not appear in today's newsletter extractions

→ Trigger web search Slot 2 for this entity (see §15)

### Relation confidence rules
- First extraction of a relation: `confidence = 0.7` (minimum for storage)
- Each subsequent independent confirmation: `+0.1`
- `confirmed = true` once confidence >= 0.9
- Relations below 0.5 at weekly pruning: deleted

### Graph pruning (weekly)
- Entities: `mention_count = 1`, no relations, `first_seen > 60 days` → delete
- Relations: `confidence < 0.5`, no subsequent confirmation → delete
- Dormant → deleted if `importance = low` and `dormant > 60 days`

---

## 12. Source Quality Evolution

### Trust score mechanics
Updated every 7 days by an automated Bun job (no AI):

```
Weekly update rules:
  IF include_rate_30d > 0.60 AND avg_revealed_relevance > 3.8:
    trust_score = min(2.0, trust_score + 0.10)
  IF include_rate_30d < 0.20 OR promotional_rate_30d > 0.50:
    trust_score = max(0.5, trust_score - 0.15)
  IF trust_score changes: update quality_trend, log reason in notes
```

### Effect on extraction
```
effective_relevance = ollama_score × trust_score (before corroboration)

trust 2.0: relevance-3 items promoted to effective 4.0 → included
trust 0.5: items need raw relevance 4+ to reach inclusion threshold of 3.0
```

### Cross-source corroboration bonus
Applied on top of trust-adjusted scores. If the same story (by entity overlap) appears in 3+ sources, each item's effective relevance gets +0.7. This operationalizes "if Import AI and SemiAnalysis and MIT Tech Review all cover the same chip story, it's important."

### Source retirement suggestion
If a source's trust_score < 0.5 for 30+ consecutive days:
- System writes a note: "Consider unsubscribing from [X] - 0 high-relevance items in 30 days, ~800 tokens/day Ollama processing wasted."
- Never acted on automatically.

---

## 13. Feedback & Calibration Loops

Three mechanisms, each with different signal quality and friction:

### Mechanism 1 - Implicit behavioral signals (zero friction, automatic)
Detection logic in Phase 6:
- If a report item's topic/entity appears in a new calendar event within 24h → `revealed_relevance = 5`
- If a report item's topic appears in a new to-do item within 24h → `revealed_relevance = 4`
- If a report item triggers a Claude Code skill execution → `revealed_relevance = 5`
- If user answers a follow-up question about a topic via question API → `revealed_relevance = 4`

Detected via cross-referencing today's calendar/todo writes with report items by keyword/entity overlap.

### Mechanism 2 - Explicit ratings (optional, ~10 seconds)
User can reply to question API with:
```
+{item_id}  →  revealed_relevance = 5, domain interest score +0.1
-{item_id}  →  revealed_relevance = 1, add filter pattern to notes
```
Item IDs are short codes printed next to each item in the report. Not required - system works without this, but accelerates calibration significantly.

### Mechanism 3 - Weekly review conversation (5 min, via Claude Code API)
Once per week (Sunday evening or Monday morning), system sends 3 questions:
1. "What story from this week did you wish you'd seen more of?"
2. "What did you consistently find irrelevant?"
3. "Any new topics, people, or companies to start tracking?"

Answers parsed by Sonnet → written to `notes` table → injected into next week's synthesis prompts.

### Calibration effect
```
domain_interest_score[domain] = base_score + Σ(feedback_events × weight)

Applied as a multiplier on Ollama's relevance score, per domain:
  score > 1.2 → domain items get +0.5 effective relevance
  score < 0.8 → domain items get -0.3 effective relevance
```
Recomputed weekly. Decays toward 1.0 over 90 days without fresh feedback (prevents stale overrides).

---

## 14. Weekly Self-Improvement Run

**Trigger:** Sunday, configurable time (default: 20:00)

### Step 1 - Analytics computation (Bun, no AI)
```
Compute from last 7 days:
- Per domain: include_rate, avg_revealed_relevance, downstream_action_rate
- Per source: include_rate, avg_revealed_relevance, promotional_rate
- Over-included items: included but revealed_relevance = 1 or no feedback
- Under-included items: filtered but triggered web search or explicit + rating within 6h
- Entity graph: new entities added, relations confirmed, dormant count
- Question gate: how many questions fired, how many were repeats (same sender)
```

### Step 2 - Prompt diff generation (1 Sonnet call, ~$0.04)
Sonnet receives: analytics summary, current active prompt versions, last 7 report short_summaries, weekly review answers (if any).

Output format:
```json
{
  "proposed_changes": [
    {
      "id": "chg_001",
      "target": "section1_prompt | section2_prompt | ollama_extraction | ollama_entity",
      "type": "add_domain | remove_domain | adjust_threshold | add_filter | reword",
      "current_text": "...",
      "proposed_text": "...",
      "rationale": "Swiss startup ecosystem appeared in 12 items, 9 included, 4 generated actions. Add as explicit priority domain.",
      "confidence": "high"
    }
  ]
}
```

### Step 3 - Human approval (via question API)
Proposed changes sent as a structured message. User responds with approve/reject per change ID. Rejected changes are logged with reason - system will not re-propose the same change for 30 days.

### Step 4 - Entity graph pruning (Bun, no AI)
Apply pruning rules from §11.

### Step 5 - Source quality recalculation (Bun, no AI)
Apply trust score update rules from §12. Log threshold crossings to notes.

**Total weekly cost:** ~$0.04 (1 Sonnet call) + Bun compute (free)

---

## 15. Web Search Module

Three search slots per day. All fire in parallel at Phase 3. Results processed by Ollama before reaching Sonnet (relevance filter: if Ollama scores web result relevance < 3, discard silently).

**Web search API:** TODO - see §23

### Slot 1 - Top active topic deep-dive (always runs)
**What:** Take the active topic with highest `update_count` OR highest corroboration today. Search for developments beyond what newsletters covered.

**Query construction (Ollama):**
```
Given this active topic headline and key entities, write a web search query (max 8 words) 
that would find today's most recent developments. Return only the query string.
Topic: {{headline}}
Entities: {{entity_names}}
Today: {{ISO_date}}
```

**Integration:** Results appended to that topic's synthesis block, labeled `[web]`.

### Slot 2 - Dormant entity monitor (conditional)
**Trigger:** An entity with `importance = high` AND `status = dormant` (absent 10+ days)

**Query:** `{entity_name} news {current_month} {current_year}`

**Integration:** If result is relevant (Ollama score ≥ 3): treated as a new item with `source_name = "web"`, elevated effective relevance. If irrelevant: discarded.

### Slot 3 - Self/project reputation monitoring (daily, rotating targets)
**Target list** (stored in `notes`, scope = "search", manually maintained):
- User's own name
- Company name (once founded)
- Current project names
- Competitive targets (added over time)

Rotate: one target per day from the list.

**Integration:** Results go into Section 2 (personal action center) as a `## Mentions` subsection. Zero results → subsection omitted.

### Future slots (do not build yet, add after day 60)
- Slot 4: Pre-meeting research (trigger: calendar event with unknown attendee in next 12h)
- Slot 5: User-specified search intent (via question API: "watch [topic] starting today")

---

## 16. Question Gate

### Trigger conditions
Any item with `unknown_context: true` after Ollama classification:
- Email from sender not in `contacts` table, content suggests a relationship (not spam)
- Invoice or payment request from unknown party
- SMS from unknown number with action-implied content
- Email with ambiguous action where context determines urgency (e.g., reply that references a prior conversation the system has no record of)

### Batching
All questions for a single run are batched into one API call. Never send one question at a time.

### Question API contract
```
POST {QUESTION_API_ENDPOINT}/questions
{
  "run_id": "2025-05-06-0630",
  "timeout_minutes": 45,
  "questions": [
    {
      "id": "q_001",
      "item_type": "email",
      "from": "alex@neuralbridge.io",
      "subject": "Following up on our conversation",
      "question": "Who is Alex from NeuralBridge? Treat as: lead | partner | personal | unknown?"
    }
  ]
}

Expected response:
{
  "run_id": "2025-05-06-0630",
  "answers": [
    { "id": "q_001", "answer": "potential investor, met at ETH Zurich event" }
  ]
}
```

### Parallelization during wait
- Section 1 synthesis begins immediately - never waits for question gate
- Section 2 synthesis blocks until gate resolves or timeout
- Final delivery: both sections merged and delivered together

### Timeout behavior (45 minutes)
Section 2 proceeds with unresolved items marked:
```
⚠ Unresolved context: email from alex@neuralbridge.io - classified as "unknown". 
Action required: answer pending question to update contact profile.
```

### Contact learning
Every answered question writes to `contacts`:
```json
{
  "identifier": "alex@neuralbridge.io",
  "name": "Alex (NeuralBridge)",
  "relationship": "potential investor, met at ETH Zurich",
  "priority": "high"
}
```
After ~2 weeks: question gate fires rarely, only for genuinely new contacts.

---

## 17. Synthesis Prompts

### Shared user profile block (~200 tokens, injected into both prompts)
```
You are compiling a morning briefing for a 22-year-old German-Swiss AI developer and founder 
based in Zurich. He is building AI products and will found an international company. He speaks 
fluent Mandarin, travels to China yearly, and has a Chinese partner. He is an analytical, 
perfectionist systems thinker (XNTP, Enneagram 5w4) with ADHD - be dense, not gentle. 
No padding. No preamble. Every sentence must earn its place.

Intelligence priorities (in order):
1. AI/LLM - breakthroughs, releases, safety, policy
2. China - geopolitics, tech sector, US-China dynamics
3. European/Swiss startup ecosystem, VC, regulation
4. Global macro affecting tech
5. Neuroscience/BCI milestones
6. Science breakthroughs
7. Dev/engineering: major releases, security events

Exclude: celebrity, sports, US domestic politics unrelated to tech/China, promotional content.
```

### Section 1 system prompt
```
{{user_profile_block}}

You are writing Section 1 of today's morning briefing: the intelligence report.

Input you will receive:
- volume_signal: light|normal|heavy (adjusts your depth vs. breadth)
- active_topics: ongoing stories with running summaries
- todays_items: extracted items from 32 newsletters, relevance-scored and novelty-flagged
- entity_contexts: relationship context for relevant entities
- web_search_results: supplementary web sources for top story
- notes_intel: standing instructions and context

Output rules:
- Organize by domain, never by source. Do not name which newsletter covered a story.
- ONGOING STORIES: start entry with "UPDATE:" then state only what is new. Do not re-explain background.
- NEW STORIES: introduce concisely, state the key claim, state why it is relevant to me specifically.
- If corroboration_count >= 3, note: "(N sources)"
- HEAVY DAY: include only top 20 items by relevance. Add ## Also noted section with one-line entries for items 21+.
- LIGHT DAY: go deeper. Include more context on ongoing stories. Accept effective_relevance >= 2.5.
- Target length: 600–900 words regardless of volume.
- Use this structure:
  ## Intelligence Briefing - {date}
  ### {Domain}
  ...
  ### Also noted
  ...
- After writing the report, append a machine-readable JSON block:
  <!--SYSTEM
  {
    "new_topics": [{"headline":"...","domain":"...","summary":"..."}],
    "updated_topics": [{"id":"...","new_summary":"...","status":"active|resolved"}],
    "new_entities": [...],
    "skill_suggestions": [{"skill":"...","reason":"...","parameters":{...}}]
  }
  -->
```

### Section 2 system prompt
```
{{user_profile_block}}

You are writing Section 2 of today's morning briefing: the personal action center.

Input you will receive:
- personal_items: classified personal emails and SMS
- question_answers: context provided by user for unknown senders
- calendar_next_7_days: upcoming events
- active_todos: current to-do list
- known_contacts: contact context
- notes_personal: standing personal instructions

Output rules:
- Group by urgency: ### Critical → ### High priority → ### Normal
- CRITICAL = action or response needed within 24h
- For each item: what it is, required action, deadline (if any)
- Cross-reference: if an email relates to a calendar event, explicitly link them
- If a to-do item already covers an email's action, note "already in to-do" - do not duplicate
- If an item should be added to calendar or to-do but hasn't been, flag it explicitly
- If intelligence section covered something directly relevant to a personal item, reference it
- Section for any self/project mentions found in web search (omit if none)
- Target length: 300–500 words
- Use this structure:
  ## Personal Action Center - {date}
  ### Critical
  ...
  ### High priority
  ...
  ### Normal
  ...
  ### Mentions (omit if empty)
  ...
- Append machine-readable JSON block:
  <!--SYSTEM
  {
    "new_contacts": [...],
    "calendar_suggestions": [...],
    "todo_suggestions": [...],
    "notes_to_write": [...]
  }
  -->
```

### Parsing Phase 6 output
After both Sonnet calls complete, parse the `<!--SYSTEM ... -->` JSON blocks to drive all Phase 6 memory writes. This eliminates the need for a separate Sonnet call for Phase 6 logic.

---

## 18. Claude Code API Bridge (Skills System)

### Philosophy
The bridge is an extensible local REST API that accepts structured skill execution requests from the briefing system. Skills are TypeScript modules loaded from a `/skills` directory - adding a `.ts` file auto-registers the skill. The system starts with conservative skills and capabilities expand over time as trust is established.

The morning briefing system is the primary caller, but the bridge is designed for any automated system to use.

### API contract
```
POST http://localhost:{PORT}/skills/execute
{
  "skill": "skill_name",
  "parameters": { ... },
  "triggered_by": "morning_briefing | manual | other",
  "run_id": "optional reference",
  "authorization_level": "auto | confirm"
}

Response:
{
  "status": "executed | pending_confirmation | rejected | failed",
  "result": "...",
  "confirmation_required": false,
  "skill_output": { ... }
}
```

### Risk levels
Each skill declares a `risk_level` in its definition:
- `low` → auto-execute, no confirmation needed
- `medium` → execute but log prominently, notify
- `high` → require explicit confirmation via question API before executing
- `critical` → never auto-execute, always confirm, brief delay built in

### Skill definition structure
```typescript
// skills/add_calendar_event.ts
export default {
  name: "add_calendar_event",
  description: "Add an event to Google Calendar",
  risk_level: "low",
  parameters: {
    title: { type: "string", required: true },
    start: { type: "string", required: true }, // ISO datetime
    end: { type: "string", required: true },
    description: { type: "string", required: false }
  },
  execute: async (params) => {
    // Google Calendar API call
  }
}
```

### Starting skills (Day 1)
| Skill | Risk | Description |
|---|---|---|
| `add_calendar_event` | low | Create Google Calendar event |
| `add_todo_item` | low | Add item to Google Tasks |
| `complete_todo_item` | low | Mark Google Tasks item done |
| `write_note` | low | Write to briefing system notes store |
| `delete_note` | low | Remove a note by ID |
| `run_web_search` | low | Execute a web search query |
| `send_question` | low | Send a question to user via question API |
| `create_file` | medium | Create a file at specified path on server |
| `run_terminal_command` | high | Execute a shell command (allowlist enforced) |
| `open_project_in_editor` | medium | Open a project directory in VS Code / Cursor |
| `git_commit` | high | Stage and commit changes with message |
| `restart_service` | high | Restart a named systemd service |
| `deploy_project` | critical | Trigger deployment pipeline for a named project |

### Terminal command allowlist (for `run_terminal_command`)
Allowlist is a JSON file, manually maintained. Starting allowlist:
```json
["bun run", "bun test", "git status", "git pull", "git log", "systemctl status", 
 "docker ps", "docker logs", "ollama list", "ping", "curl -I"]
```

### Skill expansion over time
New skills are added by creating a new `.ts` file in the skills directory. The bridge auto-discovers and registers it on next restart. Keep a `skills/README.md` documenting all installed skills, their risk levels, and the date added. Before adding a `critical`-risk skill, test it manually for 2 weeks.

### Security
- Bridge binds to `localhost` only - never exposed to internet
- All executions logged to `skill_executions` table
- Weekly review: check skill_executions for unexpected patterns
- `critical` skills have a 30-second built-in delay after confirmation receipt before execution (allows cancellation)

---

## 19. External Integrations

### Email (IMAP)
- Server: Netcup hosted (self-hosted migration possible later - plan is compatible with either)
- Protocol: IMAP with Message-ID dedup (already-seen emails skipped)
- Polling: active pull at Phase 1, not IMAP IDLE (more reliable for batch processing)
- All newsletters and personal emails forward to a single unified inbox for ingestion
- HTML stripping: remove `<style>`, `<script>`, images, unsubscribe footers, tracking pixels before storing
- Library: `node-imap` or Bun-compatible IMAP client

### SMS (Android forwarding service)
- Android SMS forwarding service → webhook endpoint on the briefing server
- Endpoint: `POST /webhook/sms` receives `{ from, body, timestamp }`
- Written to `raw_items` with `source_type = "sms"`
- Processed through personal email classification prompt (same Ollama flow)

### Google Calendar
- API: Google Calendar API v3
- Auth: OAuth 2.0 service account or user credentials
- Read: fetch events for next 7 days at Phase 1
- Write: `add_calendar_event` skill
- Store calendar data in Phase 1 output, do not cache in Postgres (always fresh)

### Google Tasks
- API: Google Tasks API v1
- Read: fetch all active tasks (status = "needsAction") at Phase 1
- Write: `add_todo_item` and `complete_todo_item` skills
- Do not cache in Postgres

### Web Search
- **TODO** - See §23. API to be decided.
- Interface: `POST /search` internal endpoint that wraps whichever API is chosen
- Abstracted behind a single interface so the search provider can be swapped without changing pipeline code

---

## 20. Passive Context Sources

Three additional data sources that enrich the system's understanding of the user without being active news inputs. All three are optional and belong in Phase 7 of the build roadmap, after the core pipeline is stable.

---

### 20.1 Google Keep Notes (~1,000 notes)

**Role:** Queryable background knowledge base. The system learns what the user has already been thinking about and surfaces connections between existing notes and today's news.

**What it does NOT do:** Never dumps all 1,000 notes into a Sonnet prompt. Never scans notes on every run.

**Initial bulk import:** Handled by the **Context Builder** (`context-builder/`), not this pipeline. Context Builder performs the one-time full scan of all ~1,000 notes via gkeepapi (Python subprocess), extracts entities and summaries with Ollama, and seeds the `entities` and `standing_context` tables. Run Context Builder before Phase 7 work begins - the `keep_notes` and `keep_index` tables it populates are what Phase 7 reads. See `CONTEXT_BUILDER_PLAN.md` for the full indexing architecture and API decision.

**Architecture:**

*Initial indexing:* → handled by Context Builder (see above).

*During Phase 3 (daily, fast Postgres lookup):*
For each of today's top 10 entities by effective relevance, query `keep_index` for entity overlap. If matches found, retrieve the relevant note summaries (not full text). Inject into Section 1 synthesis payload as a `user_prior_context` block:
```
[Prior context: You have 3 notes mentioning Neuralink - last from February, tagged "BCI investment thesis".]
```
Sonnet uses this to connect today's news to existing thinking. This is how the system feels like it knows you rather than treating you as a generic reader.

*Weekly re-index (ongoing delta):*
Run Ollama extraction on notes created or modified since last Context Builder run. ~5–10 new notes per week typically. Reuses the same gkeepapi scripts and `context_builder_indexed_items` skip-set from Context Builder. No full re-index needed.

**API challenge:** Decided - gkeepapi (Python subprocess) only. Auth scripts live in `context-builder/scripts/`. (Google Keep API `keep.googleapis.com` is Workspace-only, not usable with a personal account.)

**Tables:**
```sql
keep_notes (
  id            text PRIMARY KEY,  -- Keep note ID from export
  raw_content   text,
  created_at    date,
  updated_at    date,
  indexed_at    timestamptz
)

keep_index (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       text REFERENCES keep_notes(id),
  topic_tags    text[],
  entities      text[],
  note_type     text,
  summary       text,
  indexed_at    timestamptz DEFAULT now()
)
```

---

### 20.2 AI Chat History

**Role:** Topic and project signal extraction. If the user has been repeatedly asking about a subject this week, that subject is genuinely active in their mind and should be weighted higher in the briefing.

**What it does NOT do:** Never sends raw chat content to any cloud API. Never includes full conversations in Sonnet payloads. Never creates a feedback loop where the system amplifies whatever was last discussed.

**Architecture:**

*Nightly extraction job (Ollama, runs at 03:00, before the 06:30 briefing):*
Query the chat history DB for conversations from the last 7 days. For each conversation, run Ollama extraction:
```json
{
  "topic_signals": ["EU AI regulation", "Bun performance", "fundraising"],
  "project_signals": ["morning briefing tool", "online OS"],
  "question_patterns": ["how does X work", "what is the best Y"],
  "entities_researched": ["Anthropic", "Y Combinator"]
}
```
Aggregate across all conversations from the week. Store in `chat_signals` table.

*Integration with relevance calibration (§13):*
`chat_signals` feeds into the domain interest scoring as a fourth feedback mechanism. Topics appearing in ≥3 chat sessions this week get a `+0.4` domain interest bonus for the next 7 days. This is the implicit signal that the user is actively thinking about something.

*Project awareness:*
`project_signals` are injected into both synthesis prompts as a "current projects" context line:
```
Current active projects this week (inferred from chat history): morning briefing tool, online OS.
Flag any news directly relevant to these.
```

**Tables:**
```sql
chat_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start      date NOT NULL,
  topic_signals   text[],
  project_signals text[],
  entity_signals  text[],
  raw_counts      jsonb,   -- {"topic": count} for frequency weighting
  created_at      timestamptz DEFAULT now()
)
```

**Retention:** `chat_signals` rows older than 30 days are deleted. Only the rolling 4-week window matters.

**Privacy note:** The chat history DB stays on the local server. Ollama processes it locally. Only the abstract signal JSON leaves the local processing step - and only to Postgres, not to any cloud API. Raw chat content is never read by Sonnet.

**User control:** A toggle in the SvelteKit dashboard enables/disables this feature entirely. Specific chat sessions can be flagged as excluded (e.g., private conversations) by tagging them in the chat history DB.

---

### 20.3 Diary

**Role:** Personal context and emotional register. The most powerful of the three sources for Section 2 quality. Allows the system to understand the user's current life phase, emotional state, and active personal concerns - and frame personal action items accordingly.

**What it does NOT do:** Raw diary content NEVER leaves the local server. NEVER processed by any cloud API including Claude Sonnet. This is a hard architectural rule, not a configurable option.

**Architecture:**

*Weekly personal context extraction (Ollama, Sunday):*
Ollama reads the last 7 diary entries and produces an abstract personal context block. The prompt is deliberately abstract - it extracts themes, not content:
```
Read these diary entries. Do NOT summarize the content. Extract only:
- Overall emotional valence (positive / neutral / stressed / struggling)
- Current life phase (e.g., "high-focus work period", "transition", "social expansion")
- Active personal concerns as abstract tags (max 5 tags, no specific names or details)
- Recurring themes as abstract tags (max 3)

Return ONLY valid JSON:
{
  "emotional_valence": "positive_with_stress",
  "current_phase": "pre-founding_intensification",
  "active_concerns": ["company_timing", "relationship_distance", "identity_transition"],
  "recurring_themes": ["ambition", "perfectionism", "belonging"]
}
```

Store in `personal_context` table with a `valid_until` date of 7 days. Refreshed weekly.

*Integration into Section 2 prompt:*
The personal context block is injected into the Section 2 system prompt:
```
Current personal context (derived locally from diary, abstract only):
Phase: pre-founding_intensification
Valence: positive_with_stress
Active concerns: company_timing, relationship_distance, identity_transition

Use this to calibrate tone and priority framing in Section 2. If an item relates to an active concern, acknowledge the connection briefly. If the user is in a high-stress period, be direct but not alarmist with urgent items.
```

This is how the system avoids treating you like a generic user. A payment deadline lands differently when the system knows you're already stressed about company timing. An invitation lands differently when it knows you're in a social expansion phase.

*Diary format compatibility:*
The system needs to read diary entries as plain text. Supported formats: Markdown files in a directory, a local SQLite DB, or a designated folder of `.txt` files. Format-specific reader implementations go in the integration layer. If the diary is in a proprietary app, an export/sync script is needed (similar to Keep).

*User review:*
The extracted personal context block is visible in the SvelteKit dashboard. The user can edit or override it at any time. If something is extracted incorrectly or too specifically, the user corrects it and that correction overrides the Ollama output until the next weekly extraction.

**Tables:**
```sql
personal_context (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start        date NOT NULL,
  emotional_valence text,
  current_phase     text,
  active_concerns   text[],
  recurring_themes  text[],
  user_overridden   boolean DEFAULT false,
  valid_until       date,
  created_at        timestamptz DEFAULT now()
)
```

---

### Summary: which sources go to which AI

| Source | Ollama | Sonnet | Rule |
|---|---|---|---|
| Google Keep | ✓ (indexing) | ✓ (matched summaries only) | Never full notes, only matched snippets |
| AI chat history | ✓ (extraction) | ✓ (abstract signals only) | Never raw content |
| Diary | ✓ (extraction) | ✓ (abstract block only) | Never raw content, ever |

---

## 21. Delivery Layer

### SvelteKit dashboard
- Primary interface: browser (desktop) and PWA (mobile)
- Report rendered from stored Markdown: Section 1 and Section 2 in separate collapsible panels
- Features:
  - Today's report (default view)
  - Historical reports (calendar-style navigation)
  - Active topics list with timeline
  - Source quality dashboard (trust scores, include rates)
  - Entity graph explorer (basic)
  - Notes management (view, add, delete)
  - Skill execution log
  - Feedback buttons (+ / -) per report item
  - Weekly prompt diff approval interface

### PWA push notification
- Trigger: Phase 6, after report is written to `daily_reports`
- Message: "Morning briefing ready - {item_count} items" (no content in notification)
- Implementation: Web Push API, service worker in SvelteKit PWA
- Requires HTTPS: ensure server has valid SSL (Let's Encrypt on Netcup)

### Report format
Final Markdown structure:
```markdown
# Morning Briefing - Monday, 6 May 2025

---

## Intelligence Briefing

### AI & Technology
...

### China
...

### Also noted
...

---

## Personal Action Center

### Critical
...

### High priority
...

### Normal
...
```

---

## 22. Token Cost Analysis

| Component | Monthly volume | Cost |
|---|---|---|
| Sonnet input (both sections, 2 calls/day) | ~12,600 tokens/day × 30 | ~$1.13 |
| Sonnet output (both sections) | ~2,000 tokens/day × 30 | ~$0.90 |
| Weekly meta-run (1 Sonnet call/week) | ~8,000 tokens × 4 | ~$0.14 |
| Ollama (all extraction calls) | Runs locally | $0 |
| Web search API | Depends on provider | ~$0–5 |
| **Total monthly** | | **~$2.20–7.20** |

The Ollama pre-processing layer compresses raw input from ~49,600 tokens to ~12,600 tokens before Sonnet - a 75% reduction. Without this, monthly Sonnet cost would be ~$8–12.

---

*Plan version: 1.1 - passive context sources added*
*Build with: Bun + SvelteKit + Postgres + DrizzleORM + Ollama (qwen2.5:14b) + Claude Sonnet 4.6*
