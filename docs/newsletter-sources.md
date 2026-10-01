# Newsletter sources

The 32 newsletters curated for the daily pipeline, with the tiering and rationale behind each pick. The live RSS feeds and email sender rules are managed at `/settings/newsletters` and loaded by `src/config/rss-feeds.ts` and `src/config/newsletter-sources.ts`. Cut from an original 50 candidates - the 18 removed were pure redundancy, wrong format for LLM parsing, or low signal-to-token ratio. Token cost was never the constraint (~$2-3/month at 50).

A newly subscribed newsletter needs no rule to be picked up: on accounts flagged `isNewsAccount`, mail from a sender with no matching sender rule is still ingested as a newsletter when it carries `List-Unsubscribe`, `List-Id` or `Precedence: bulk`/`list` (`isBulkMail` and `classifyEmail` in `src/ingest/sources.ts`), named by the sender's display name, else its domain. Explicit address and domain rules always win, and non-news accounts are unchanged because transactional mail carries `List-Unsubscribe` too. Add a rule at `/settings/newsletters` to pin a canonical source name.

Tier S = essential daily reads. A = high-value, subscribe immediately. B = niche but earns its place. C = narrow but frontier-relevant.

| # | Tier | Name | Author | Domain | Cadence | Free tier | Why it's here |
|---|---|---|---|---|---|---|---|
| 1 | S | Astral Codex Ten | Scott Alexander | Philosophy/AI | Weekly | Mostly free | Surgical precision, intellectual courage - best available philosophy/rationality writing |
| 2 | S | The Intrinsic Perspective | Erik Hoel | Neuroscience/Philosophy | Weekly | Free tier | Academic depth, contrarian within the field - feeds BCI and identity philosophy interests |
| 3 | S | Exponential View | Azeem Azhar | AI + Geopolitics | Weekly | Free tier | Rare cross-domain synthesis: AI + economics + geopolitics + energy in one lens |
| 4 | S | Import AI | Jack Clark | AI Research | Weekly | Free | Most technically honest AI newsletter - papers, capability analysis, safety, policy |
| 5 | S | The Diff | Byrne Hobart | Finance + Tech | 5x/week | Free tier (2x) | 1,500-word analytical essays, maximum density |
| 6 | S | Not Boring | Packy McCormick | Startups | Mon + Thu | Free | 5,000-word startup strategy deep-dives, essential founder education |
| 7 | S | Money Stuff | Matt Levine | Finance | Daily | Free (Bloomberg signup) | Best financial writer active; high income + founding plans make this essential |
| 8 | S | Sinocism | Bill Bishop | China | 4x/week | Limited free | Gold-standard China newsletter, professionally critical given the standing China interest |
| 9 | A | The Generalist | Mario Gabriele | Startups | Weekly | Free tier | 5,000-word company/sector analyses, investment-bank research quality |
| 10 | A | Farnam Street Brain Food | Shane Parrish | Mental Models | Weekly | Free | Mental models and decision frameworks |
| 11 | A | Works in Progress | Various | Science/Progress | Irregular | Free | Long-form essays on science and civilizational progress |
| 12 | A | Experimental History | Adam Mastroianni | Psychology | Irregular | Free | Empirical psychology through a skeptical lens, challenges consensus with data |
| 13 | A | Noahpinion | Noah Smith | Economics | 3x/week | Free tier | Heterodox economics, strong on Asia and industrial policy |
| 14 | A | China Brief | James Palmer (Foreign Policy) | China | Weekly | Free | Weekly China digest, complements Sinocism from a different angle |
| 15 | A | TLDR AI | Dan Ni | AI | Daily | Free | Best-structured daily AI newsletter for programmatic parsing |
| 16 | A | MIT Tech Review: The Download | MIT Tech Review | Science/Tech | Daily | Free | Credentialed science journalism covering BCI, AI, medicine without hype |
| 17 | A | Benedict Evans | Benedict Evans | Tech Strategy | Weekly | Free | Frameworks for tech displacement cycles |
| 18 | A | SemiAnalysis | Dylan Patel | AI Infrastructure | Irregular | Limited free | Deepest AI hardware / semiconductor economics analysis available |
| 19 | A | Term Sheet | Dan Primack | VC | Daily | Free | Gold-standard VC/M&A news, best sourcing in venture journalism |
| 20 | A | ChinaTalk | Jordan Schneider | China + Tech | Irregular | Free tier | Chinese AI labs, chip policy, US-China tech decoupling - fills a gap neither Sinocism nor China Brief covers |
| 21 | A | Hacker Newsletter | Kale Davis | Dev | Weekly | Free | Curated best-of Hacker News, clean format |
| 22 | A | Quanta Magazine | Quanta | Science | Weekly | Free | Elite science journalism - math, physics, biology, does not simplify |
| 23 | A | FoundMyFitness | Rhonda Patrick | Longevity | Irregular | Free | Science-first longevity research, no biohacking hype |
| 24 | B | PESTLE and MORTAR | Insight Forward | Geopolitics | Weekly | Free | Weekly geopolitical risk covering China, semiconductors, AI policy |
| 25 | B | What's on Weibo | Manya Koetse | China Social | Irregular | Free | Chinese internet culture and social discourse in English |
| 26 | B | Interconnected | Kevin Xu | China + Tech | Irregular | Free | US-China tech intersection, decoupling, international founder implications |
| 27 | B | War on the Rocks | Various | Security/FP | Daily | Free | Defense and foreign policy by former practitioners |
| 28 | B | Palladium Magazine | Various | Political Philosophy | Irregular | Free | Governance, political theory, civilizational futures |
| 29 | B | Following the Yuan | Yaling Jiang | China Business | Irregular | Free | China consumer market and business |
| 30 | B | Console.dev | Console | Dev Tools | Weekly | Free | Curated developer tools and open-source projects |
| 31 | B | Bytes.dev | Tyler McGinnis | JavaScript | Weekly | Free | JS ecosystem, directly relevant to the SvelteKit stack |
| 32 | C | NeuroNews International | Various | Neuroscience/BCI | Weekly | Free | Clinical neuroscience and BCI trials, keeps the BCI interest frontier-level |

**Netzpolitik.org** (German, digital politics/EU regulation) was considered as a 33rd source and declined 2026-09-10 with no re-evaluation window - see `CLAUDE.md`, "What not to build (yet)". 32 sources is already past the point where a marginal source dilutes more than it adds.
