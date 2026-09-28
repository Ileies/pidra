# Prompt tuning context

Reference material for anyone tuning the extraction or synthesis prompts (`src/ai/prompts.ts`). Migrated from the retired `CONTEXT_AND_DECISIONS.md`; not architecture rules, just the rationale behind specific prompt choices.

## Reader profile (design rationale only)

The actual profile lives in Postgres now (`standing_context`, `profile_*` keys) and is injected at runtime - see `src/pipeline/long-term-context.ts`. What follows is *why* several prompt behaviors exist, not live data:

- Reads sources in several languages including Chinese - source selection assumes that.
- China is a standing personal and strategic interest, not casual geopolitical curiosity. A pre-trip window (2 weeks before any China flight) should boost China content.
- Planning to found internationally - EU and Swiss regulatory context is professionally relevant, not just interesting.
- Needs high novelty per paragraph, clear section structure, no recap sentences, no padding. This is functional, not an aesthetic preference.
- Deep production experience across the stack (Bun, SvelteKit, Postgres, DrizzleORM, NixOS, OpenAI, auth, deployment) - no scaffolding or boilerplate explanations needed anywhere the model writes about the user's own work.

## Intelligence priorities (Section 1 / newsletter path)

Ordered - when forced to choose between two stories, rank by this list:

1. AI/LLM - breakthroughs, model releases, capability jumps, safety developments, policy changes
2. China - geopolitics, US-China dynamics, Chinese tech sector, domestic policy, Sino-Swiss or Sino-German news
3. European/Swiss startup ecosystem - VC funding rounds, EU regulation (AI Act, GDPR enforcement, DSA), Swiss-specific business news
4. Global macro - interest rates, currency movements, geopolitical crises with tech implications
5. Neuroscience/BCI - clinical trials, device approvals, research milestones
6. Science - physics, biology, longevity, aging biology, chemistry breakthroughs
7. Dev/engineering - major framework releases (especially Bun, SvelteKit, Postgres, NixOS), security events, tooling shifts

**Exclude always (Section 1 only):** celebrity, sports, US domestic politics unrelated to tech or China, promotional content, items with effective relevance < 3.

**These exclusions do not apply to the News section** (added 2026-09-25): the News section is the reader's only news source, so it includes anything of major public salience regardless of domain - a globally famous person attacked, a war, a disaster in the home city. See `CLAUDE.md`'s News section rule.

**Boost automatically:**
- Stories covered by 3+ newsletters (corroboration signal)
- Stories connecting two or more priority domains - cross-domain connections are the highest-value output
- Stories directly relevant to active personal projects
- Any development in Switzerland or affecting Swiss residents

## Report format requirements

Functional requirements, not style preferences:

- No recap sentences ("as mentioned above," "this means that") - never.
- No padding. Every sentence introduces something new.
- Clear hierarchy: section headers, urgency levels, "Also noted" - structure is read before content.
- `UPDATE:` prefix on continuing stories - signals "don't re-read background, just read the delta."
- One-liners in "Also noted" - single-sentence claim only, not a summary.
- Cross-domain connections made explicit - if an AI story connects to a China story, state the link directly, never implicitly.
- Section 2 urgency labels are load-bearing: Critical/High/Normal must be correct. A wrongly-labeled urgent item that gets skipped has real consequences.
- **Target length: Section 1 at most 900 words, less on a light day. Section 2: 300-500 words.** Revised 2026-09-25 from "600-900 regardless of input volume": the floor was what turned a thin day's six items (a neurology society's leadership election, an 18th-century book) into two-paragraph essays, and the reader had started scrolling past Section 1 altogether. With the News section now carrying what happened, Section 1 is the depth layer and is as long as its material warrants. The same revision dropped the old "go deeper on a light day" 2.5 relevance floor, which the gate had already made dead (nothing under 3 reaches synthesis).
- News section: one bullet per story, a bold headline sentence plus the facts needed to retell it, at most 45 words. No analysis - it's read to know what happened, the newsletters are where depth lives.

## Newsletter processing tiers

- **Daily/high-volume sources** (TLDR AI, Money Stuff, Term Sheet, MIT Tech Review, The Diff, War on the Rocks, Sinocism, Noahpinion): short extraction pass, focused on claim + entity identification.
- **Weekly/irregular, dense sources** (Astral Codex Ten, The Intrinsic Perspective, Not Boring, The Generalist, Works in Progress, SemiAnalysis): richer extraction prompt capturing the central argument, not just claims. Extraction output gets `source_format: "essay"`; synthesis gives essay items more depth in the report.

## Ongoing stories

The most common digest-briefing failure mode is re-explaining background every day. `active_topics` plus the `UPDATE:` prefix solve this: a story running for a week becomes two sentences - what changed today, what it implies.
