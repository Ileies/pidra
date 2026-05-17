// Known newsletter sources: sender domains/addresses that map to a source name.
// Used to classify incoming emails as "newsletter" vs "personal_email".
export const NEWSLETTER_SOURCES: Record<string, string> = {
  // Domain patterns → source name
  "astralcodexten.com": "Astral Codex Ten",
  "substack.com": "", // catch-all substack — name inferred from sender name
  "erikhoel.substack.com": "The Intrinsic Perspective",
  "exponentialview.co": "Exponential View",
  "importai.substack.com": "Import AI",
  "thediff.co": "The Diff",
  "notboring.co": "Not Boring",
  "bloomberg.net": "Money Stuff",
  "sinocism.com": "Sinocism",
  "generalist.com": "The Generalist",
  "fs.blog": "Farnam Street Brain Food",
  "worksinprogress.news": "Works in Progress",
  "experimental-history.com": "Experimental History",
  "noahpinion.substack.com": "Noahpinion",
  "foreignpolicy.com": "China Brief",
  "tldr.tech": "TLDR AI",
  "technologyreview.com": "MIT Technology Review",
  "ben-evans.com": "Benedict Evans",
  "semianalysis.com": "SemiAnalysis",
  "fortune.com": "Term Sheet",
  "chinatalk.media": "ChinaTalk",
  "hackernewsletter.com": "Hacker Newsletter",
  "quantamagazine.org": "Quanta Magazine",
  "foundmyfitness.com": "FoundMyFitness",
  "insightforward.co.uk": "PESTLE and MORTAR",
  "whatsonweibo.com": "What's on Weibo",
  "interconnect.substack.com": "Interconnected",
  "warontherocks.com": "War on the Rocks",
  "palladiummag.com": "Palladium Magazine",
  "followingtheyuan.substack.com": "Following the Yuan",
  "console.dev": "Console.dev",
  "bytes.dev": "Bytes.dev",
  "neuronewsinternational.com": "NeuroNews International",
  "netzpolitik.org": "Netzpolitik.org",
};

// Email addresses that are "self" — never classify as incoming action item
export const SELF_EMAILS = [
  "info@pidra.de",
  "elias.klassen@offlimits-it.com",
];

// Specific sender email addresses that are always newsletters
export const NEWSLETTER_EMAILS: Record<string, string> = {
  "astralcodexten@substack.com": "Astral Codex Ten",
  "bill@sinocism.com": "Sinocism",
  "letters@noahpinion.substack.com": "Noahpinion",
  "jack@importai.substack.com": "Import AI",
  "packy@notboring.co": "Not Boring",
};

export function classifyEmail(from: string): { sourceType: "newsletter" | "personal_email"; sourceName: string | null } {
  const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase().trim();
  const senderDomain = senderEmail.split("@")[1] ?? "";
  const senderName = (from.match(/^([^<]+)</) ?? [])[1]?.trim() ?? "";

  // Check exact email match first
  if (NEWSLETTER_EMAILS[senderEmail]) {
    return { sourceType: "newsletter", sourceName: NEWSLETTER_EMAILS[senderEmail] };
  }

  // Check against known newsletter domains
  for (const [domain, name] of Object.entries(NEWSLETTER_SOURCES)) {
    if (senderDomain === domain || senderDomain.endsWith("." + domain)) {
      return { sourceType: "newsletter", sourceName: name || senderName || null };
    }
  }

  // Substack catch-all (any @substack.com sender is a newsletter)
  if (senderDomain === "substack.com" || senderDomain.endsWith(".substack.com")) {
    return { sourceType: "newsletter", sourceName: senderName || null };
  }

  return { sourceType: "personal_email", sourceName: senderEmail };
}
