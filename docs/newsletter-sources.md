# Newsletter sources

The 32 newsletters curated for the daily pipeline, with the tier and rationale behind each pick. This is the curation record, not the live configuration: the live sender rules and RSS feeds are rows in `newsletter_sender_rules` and `rss_feeds`, edited at `/settings/newsletters` and loaded by `src/config/newsletter-sources.ts` and `src/config/rss-feeds.ts`. Migration `0027_newsletter_sources.sql` seeded them. The list was cut from 50 candidates; the 18 removed were redundant, in a format that parses badly, or low in signal per token.

Tiers: **S** essential daily reads, **A** high value, **B** niche but earns its place, **C** narrow but frontier-relevant.

## How a mail becomes a newsletter

On accounts flagged `isNewsAccount`, `classifyEmail` (`src/ingest/sources.ts`) decides per message:

1. An exact sender-address rule wins.
2. Otherwise the longest matching domain rule wins, so a specific publication beats a generic parent such as `substack.com`.
3. Otherwise a message carrying `List-Unsubscribe`, `List-Id` or `Precedence: bulk|list` (`isBulkMail`) is still a newsletter, named by the sender's display name, else its domain. A newly subscribed newsletter therefore needs no rule; add one at `/settings/newsletters` only to pin a canonical name.
4. Anything else is personal mail.

Accounts not flagged `isNewsAccount` never produce newsletters, because transactional mail carries `List-Unsubscribe` too. A newsletter whose source also has an RSS feed is dropped from the mail path (`covered_by_rss`), since the feed content is cleaner.

## Sources

| # | Tier | Name | Domain | Cadence | Why it's here |
|---|---|---|---|---|---|
| 1 | S | Astral Codex Ten | Philosophy/AI | Weekly | Best available philosophy and rationality writing |
| 2 | S | The Intrinsic Perspective | Neuroscience/Philosophy | Weekly | Academic depth, contrarian within the field |
| 3 | S | Exponential View | AI + Geopolitics | Weekly | Rare cross-domain synthesis of AI, economics, geopolitics and energy |
| 4 | S | Import AI | AI Research | Weekly | Technically honest: papers, capabilities, safety, policy |
| 5 | S | The Diff | Finance + Tech | 5x/week | Dense 1,500-word analytical essays |
| 6 | S | Not Boring | Startups | Mon + Thu | Long startup strategy deep-dives |
| 7 | S | Money Stuff | Finance | Daily | Best financial writing active |
| 8 | S | Sinocism | China | 4x/week | Gold-standard China newsletter |
| 9 | A | The Generalist | Startups | Weekly | Company and sector analyses at investment-research quality |
| 10 | A | Farnam Street Brain Food | Mental Models | Weekly | Mental models and decision frameworks |
| 11 | A | Works in Progress | Science/Progress | Irregular | Long-form essays on science and progress |
| 12 | A | Experimental History | Psychology | Irregular | Empirical psychology that challenges consensus with data |
| 13 | A | Noahpinion | Economics | 3x/week | Heterodox economics, strong on Asia and industrial policy |
| 14 | A | China Brief | China | Weekly | Digest from a different angle than Sinocism |
| 15 | A | TLDR AI | AI | Daily | Best-structured daily AI newsletter for parsing |
| 16 | A | MIT Technology Review | Science/Tech | Daily | Credentialed journalism on BCI, AI and medicine without hype |
| 17 | A | Benedict Evans | Tech Strategy | Weekly | Frameworks for tech displacement cycles |
| 18 | A | SemiAnalysis | AI Infrastructure | Irregular | Deepest AI hardware and semiconductor economics |
| 19 | A | Term Sheet | VC | Daily | Best sourcing in venture and M&A news |
| 20 | A | ChinaTalk | China + Tech | Irregular | Chinese AI labs, chip policy, US-China decoupling; fills a gap Sinocism and China Brief leave |
| 21 | A | Hacker Newsletter | Dev | Weekly | Curated best of Hacker News |
| 22 | A | Quanta Magazine | Science | Weekly | Elite math, physics and biology journalism that does not simplify |
| 23 | A | FoundMyFitness | Longevity | Irregular | Science-first longevity research, no biohacking hype |
| 24 | B | PESTLE and MORTAR | Geopolitics | Weekly | Geopolitical risk across China, semiconductors and AI policy |
| 25 | B | What's on Weibo | China Social | Irregular | Chinese internet culture in English |
| 26 | B | Interconnected | China + Tech | Irregular | US-China tech intersection |
| 27 | B | War on the Rocks | Security/FP | Daily | Defense and foreign policy by former practitioners |
| 28 | B | Palladium Magazine | Political Philosophy | Irregular | Governance and civilizational futures |
| 29 | B | Following the Yuan | China Business | Irregular | China consumer market and business |
| 30 | B | Console.dev | Dev Tools | Weekly | Curated developer tools and open-source projects |
| 31 | B | Bytes.dev | JavaScript | Weekly | JS ecosystem, close to the SvelteKit stack |
| 32 | C | NeuroNews International | Neuroscience/BCI | Weekly | Clinical neuroscience and BCI trials |
