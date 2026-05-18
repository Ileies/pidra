// RSS feed URLs for each newsletter source.
// Newsletters listed here are fetched via RSS instead of IMAP (cleaner content, no HTML footers).
// Sources not listed here (null entries or missing) continue via IMAP.
export const RSS_FEEDS: Record<string, string> = {
  "Astral Codex Ten": "https://astralcodexten.substack.com/feed",
  "The Intrinsic Perspective": "https://erikhoel.substack.com/feed",
  "Exponential View": "https://www.exponentialview.co/feed",
  "Import AI": "https://importai.substack.com/feed",
  "The Diff": "https://www.thediff.co/rss",
  "Not Boring": "https://notboring.substack.com/feed",
  "Sinocism": "https://sinocism.substack.com/feed",
  "The Generalist": "https://generalist.substack.com/feed",
  "Farnam Street Brain Food": "https://fs.blog/feed",
  "Works in Progress": "https://www.worksinprogress.news/feed",
  "Experimental History": "https://experimental-history.substack.com/feed",
  "Noahpinion": "https://noahpinion.substack.com/feed",
  "MIT Technology Review": "https://www.technologyreview.com/feed",
  "SemiAnalysis": "https://semianalysis.substack.com/feed",
  "ChinaTalk": "https://chinatalk.substack.com/feed",
  "Hacker Newsletter": "https://hackernewsletter.substack.com/feed",
  "Quanta Magazine": "https://www.quantamagazine.org/feed",
  "FoundMyFitness": "https://foundmyfitness.libsyn.com/rss",
  "What's on Weibo": "https://www.whatsonweibo.com/feed",
  "Interconnected": "https://interconnect.substack.com/feed",
  "War on the Rocks": "https://warontherocks.com/feed",
  "Palladium Magazine": "https://www.palladiummag.com/feed",
  "Following the Yuan": "https://followingtheyuan.substack.com/feed",
  "NeuroNews International": "https://neuronewsinternational.com/feed",
};

// Quick lookup set — used by IMAP ingestor to skip emails from RSS-covered sources.
export const RSS_SOURCE_NAMES = new Set(Object.keys(RSS_FEEDS));

// Sources without public RSS — ingested via IMAP only:
// - Money Stuff (Bloomberg) — no public RSS
// - China Brief (Foreign Policy) — paid, RSS blocked
// - Benedict Evans — deliberately disabled RSS
// - Term Sheet (Fortune) — no public RSS
// - TLDR AI — no official RSS
// - PESTLE and MORTAR — no RSS
// - Console.dev — no public RSS endpoint
// - Bytes.dev — no official RSS
