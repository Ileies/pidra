<script lang="ts">
  /**
   * The one error boundary for the app. Its job for this file is narrow: turn a failed load on a
   * Tier B page (OFFLINE_PLAN.md §1, O4) into `OfflineNotice` instead of a raw fetch-failure dump,
   * when the reason really does look like connectivity rather than a bug. Everything else - a
   * genuine 404, a genuine 500 while reachable - still shows the plain status and message, because
   * masking those as "needs the connection" would send the wrong page to look at what actually
   * broke.
   */
  import { page } from "$app/state";
  import Page from "#lib/components/Page.svelte";
  import OfflineNotice from "#lib/components/OfflineNotice.svelte";
  import { offline } from "#lib/offline/state.svelte.js";

  /** Tier B (OFFLINE_PLAN.md §1): live operational state a cached copy would misrepresent, so
   *  these stay online-only rather than being converted to `ssr = false` + a mirror. */
  const TIER_B: Record<string, { label: string; reason: string }> = {
    "/sources": { label: "Sources", reason: "Source trust scores are a live query against the pipeline's own tables." },
    "/sources/[name]": { label: "Sources", reason: "A source's delivery history is a live query against the pipeline's own tables." },
    "/feedback": { label: "Feedback", reason: "The rating log is a live query against the pipeline's own tables." },
    "/skills": { label: "Skills", reason: "The approval queue and execution log are live state, not something a cache can represent honestly." },
    "/prompts": { label: "Prompts", reason: "Prompt versions are a live query against the pipeline's own tables." },
    "/runs": { label: "Runs", reason: "Pipeline run history is a live query against the pipeline's own tables." },
    "/questions": { label: "Questions", reason: "A pending question gate is live state, not something a cache can represent honestly." },
    "/chat": { label: "Chat", reason: "The assistant needs a live connection to the model." },
    "/[date]/triage": { label: "Triage", reason: "Triage is a live query against the pipeline's own tables." },
  };

  const tierB = $derived(page.route.id ? TIER_B[page.route.id] : undefined);
  // Only reframe the error when it actually looks like connectivity - a real bug on a Tier B page
  // while reachable still shows as a real error, not a misleading "needs the connection".
  const showOfflineNotice = $derived(!!tierB && offline.reachable !== "online");
</script>

{#if showOfflineNotice && tierB}
  <OfflineNotice label={tierB.label} reason={tierB.reason} />
{:else}
  <Page title="Error" size="read">
    <div class="flex flex-col items-center gap-2 py-16 text-center">
      <h1 class="text-lg font-semibold text-surface-100">{page.status}</h1>
      <p class="text-sm text-surface-400">{page.error?.message ?? "Something went wrong."}</p>
    </div>
  </Page>
{/if}
