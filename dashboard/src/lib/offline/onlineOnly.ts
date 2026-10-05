/**
 * The pages that need the connection, and what `OfflineNotice` says about each. Prose, kept apart
 * from the registry in `routes.ts` so a reworded reason is not a change to the navigation.
 */

import type { RouteDef } from "#lib/routes.js";

/** Pages that need the connection, with the one line `OfflineNotice` says about why. */
export const ONLINE_ONLY: Readonly<Record<string, { label: string; reason: string }>> = {
  "/login": { label: "Login", reason: "Signing in needs a live connection to verify the passkey and PIN." },
  "/setup": { label: "Passkey", reason: "Registering a passkey or changing the PIN needs a live connection." },
  "/sources": { label: "Sources", reason: "Source trust scores are a live query against the pipeline's own tables." },
  "/sources/[name]": { label: "Sources", reason: "A source's delivery history is a live query against the pipeline's own tables." },
  "/skills": { label: "Skills", reason: "The approval queue and execution log are live state, not something a cache can represent honestly." },
  "/skills/executions": { label: "Recent executions", reason: "Skill execution history is live state and may contain results that are not available offline." },
  "/runs": { label: "Runs", reason: "Pipeline run history is a live query against the pipeline's own tables." },
  "/runs/[id]": { label: "Run breakdown", reason: "A run's step timing and cost are a live query against the pipeline's own tables." },
  "/questions": { label: "Questions", reason: "The question queue is live state: an answer queued offline could land on a question the pipeline has since merged or closed." },
  "/questions/closed": { label: "Recently closed questions", reason: "Question history is live state and a reopened question can return to the queue at any time." },
  "/chat": { label: "Chat", reason: "The assistant needs a live connection to the model." },
  "/[date]/triage": { label: "Triage", reason: "Triage is a live query against the pipeline's own tables." },
  "/settings/email-accounts": {
    label: "Email accounts",
    reason: "Managing IMAP/SMTP credentials needs a live connection, and offline is never the right place to queue a password change.",
  },
  "/settings/newsletters": {
    label: "Newsletter sources",
    reason: "RSS feed health is a live query against the pipeline's own tables.",
  },
  "/settings/newsletters/rules": {
    label: "Email sender rules",
    reason: "Sender rules route mail into extraction on the next run and need a live connection to edit.",
  },
};

const ONLINE_ONLY_PATTERNS = Object.entries(ONLINE_ONLY).map(([id, notice]) => ({
  pattern: new RegExp(`^${id.replace(/\[[^\]]+\]/g, "[^/]+")}/?$`),
  notice,
}));

/**
 * The `ONLINE_ONLY` entry for a pathname. By path, not by route id: when a page's server data
 * never arrives, SvelteKit renders the error boundary with `page.route.id` still null, and that is
 * exactly the moment `OfflineNotice` needs the page's name.
 */
export function onlineOnlyFor(pathname: string): { label: string; reason: string } | undefined {
  return ONLINE_ONLY_PATTERNS.find(({ pattern }) => pattern.test(pathname))?.notice;
}

/** True when a nav entry's own page cannot open offline. Its children are judged separately. */
export function needsConnection(entry: RouteDef): boolean {
  return entry.id in ONLINE_ONLY;
}
