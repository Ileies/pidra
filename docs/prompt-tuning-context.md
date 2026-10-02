# Prompt tuning context

Rationale behind specific prompt choices, for anyone tuning the extraction or synthesis prompts in `src/ai/prompts/`. Not architecture rules (those are in `docs/architecture-rules.md`). Exact thresholds and formulas are in `docs/scoring-formulas.md`.

## What the prompts know about the reader

Nothing, by design. The repository is public, so `src/ai/prompts/style.ts` carries tone and format only. Who the reader is arrives at runtime in the payload: `long_term_context` (the Context Builder document), `standing_rules` (`standing_context`), `notes_intel` and `notes_personal` (`notes`). Topic priorities and exclusions belong in the `intel` notes, not in prompt code. Constraints that do shape the prompts:

- The reader needs high novelty per paragraph, clear structure and no padding. That is functional: the briefing is read once, on a phone.
- The reader is an experienced engineer, so anything written about their own work needs no scaffolding or boilerplate explanation.
- Sources and the reader's interests span several languages and regions, so prompts must not assume an English-only, single-country view.
- A calendar-driven boost (more China coverage before a China trip) is intended but not built; no code reads the calendar for relevance.

## Intelligence priorities (Section 1)

Extraction's `relevance_score` feeds the gate directly (`effective_relevance = relevance_score * trust_score`, threshold 3.0), so it has to discriminate, not just restate these priorities in words. Two observed failure modes shaped the rubric in `src/ai/prompts/extraction.ts`:

- **Scores clustering at 3.** Most items landed on the pass/fail line by construction, so gate pass rates swung day to day. All five levels are now anchored, and the prompt says not to default to the middle.
- **Teasers passing the gate.** Link-list and table-of-contents lines scored exactly 3 and every one was rated not relevant. Extraction now sets `substance` (`fact|argument|teaser`), and the gate holds a teaser back with reason `teaser_only` before looking at the score.

The same rubric caps "talk" at 2 (statements, accusations, opened investigations, "could" scenarios, minor personnel moves, abstract analyses with no new finding), scores a new dev tool at least 3, counts an essay as one to three items rather than one per paragraph, and requires `key_claim` to state the claim itself, not describe the newsletter. Its effect is judged on real mornings; see `docs/todo/now.md`.

**Where this ranking lives:** it is the reader's intent, not code. No prompt in `src/ai/prompts/` states it; Section 1 is only told not to override "the topic priorities in `notes_intel`", so the list is expected to be kept in the `intel` notes (`notes` scope `intel`), and extraction's rubric refers to a "priority domain" without naming one. Check those notes before tuning against this list. Boosts and exclusions below are likewise intent. The China pre-trip boost is not implemented.

When two stories compete, the intended ranking is:

1. AI/LLM: breakthroughs, model releases, capability jumps, safety, policy
2. China: geopolitics, US-China dynamics, tech sector, domestic policy
3. European and Swiss startup ecosystem: funding, EU regulation (AI Act, GDPR enforcement, DSA)
4. Global macro with tech implications
5. Neuroscience and BCI: trials, device approvals, research milestones
6. Science: physics, biology, longevity, chemistry
7. Dev and engineering: major framework releases, security events, tooling shifts

Boost automatically: stories covered by 3+ newsletters, stories connecting two or more priority domains (cross-domain links are the highest-value output), stories bearing on active personal projects.

Exclude from Section 1: celebrity, sports, US domestic politics unrelated to tech or China, promotional content, and anything under effective relevance 3. **The News section is exempt.** It is the reader's only news source, so it covers anything of major public salience whatever the domain (see the News rule in `docs/architecture-rules.md`).

## Report format requirements

Functional, not stylistic:

- No recap sentences and no padding; every sentence introduces something new.
- Clear hierarchy (section headers, urgency levels, "Also noted"): structure is read before content.
- `UPDATE:` prefix on continuing stories, meaning "skip the background, read the delta".
- "Also noted" entries are one sentence stating a concrete fact, not a summary.
- Cross-domain connections are stated explicitly, never implied.
- Section 2 urgency labels (Critical/High/Normal) are load-bearing: a wrongly labelled urgent item that gets skipped has real consequences.
- **Length.** Section 1 at most 900 words, less on a light day; Section 2 300-500 words; the News section 250-550 words. Section 1 used to have a 600-900 word floor, which turned a thin day's handful of items into padded essays; with the News section carrying what happened, Section 1 is the depth layer and is as long as its material warrants.
- **News bullets.** One per story: a bold headline sentence plus the facts needed to retell it, at most 35 words in total, no analysis. Newsletters are where depth lives.

## Newsletter processing

- **Extraction is one prompt for every source.** The idea of a richer extraction for dense weekly essay sources (`source_format: "essay"`, central argument rather than claims) is not implemented: `phase2-extract.ts` runs the same newsletter prompt regardless of tier or cadence.
- **RSS body** (`src/ingest/rss.ts`): the full post from `content:encoded` is preferred over the `contentSnippet` teaser, capped at 16000 characters. Reading only the snippet made extraction write "The newsletter examines X" from a title alone. Feeds that carry no full text (Money Stuff, Console.dev and War on the Rocks at last check) still extract from a short snippet.

## Output language and prompt tags

Prompt text may contain `{{tag}}` placeholders, filled in one pass by `renderPrompt` (`src/ai/prompt-vars.ts`) from values the code chose. The only tag is `{{language}}`, the English name of the owner's content language. `activePrompt()` returns the rendered text; `resolveActivePrompts()` stays raw, so `/prompts` and the weekly prompt review see the template as written. An unknown tag is left in place and logged.

The reader-facing sections (`LANGUAGE_SECTIONS` in `src/ai/prompt-catalog.ts`: `section1`, `section2`, `news`, `quick_actions`, `questions`) carry the shared `OUTPUT_LANGUAGE` rule from `src/ai/prompts/language.ts`. It keeps what code parses in English: `##` and fixed `###` headings, refs comments, and SYSTEM block keys and fixed values. Never translate those in a prompt edit. A DB prompt version written without `{{language}}` ignores the setting and logs a warning, so keep the tag when approving a rewrite. Extraction, the news desks and answer classification stay English on purpose.

## Ongoing stories

The common failure of digest briefings is re-explaining background daily. `active_topics` plus the `UPDATE:` prefix fix it: a story running for a week becomes two sentences, what changed and what it implies.
