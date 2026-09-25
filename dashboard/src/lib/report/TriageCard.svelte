<script lang="ts">
  /**
   * One ingested mail on the triage view, with the verdict on every item extracted from it.
   *
   * The card's job is to make the sum visible, not just the result. "Below the bar" on its own
   * invites the reader to argue with a number they cannot see; `3 x 0.90 trust + 0.30 = 3.00,
   * needed 3` tells them which of the three inputs to go and change - the extraction prompt, the
   * source's trust score, or the threshold.
   */
  import Badge from "#lib/components/Badge.svelte";
  import { fmtDateTimeShort, fmtScore } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import type { Outcome, TriageExtraction, TriageItem } from "#lib/server/triage.js";

  interface Props {
    item: TriageItem;
    date: string;
  }

  let { item, date }: Props = $props();

  type Tone = "neutral" | "muted" | "primary" | "success" | "warning" | "error";

  const OUTCOME: Record<Outcome, { label: string; tone: Tone; hint: string }> = {
    in_report: {
      label: "In the report",
      tone: "success",
      hint: "Cited by synthesis and shown in the briefing.",
    },
    passed: {
      label: "Reached synthesis",
      tone: "primary",
      hint: "It cleared the gate, and synthesis chose not to write about it.",
    },
    gated: {
      label: "Dropped at the gate",
      tone: "warning",
      hint: "Extracted and scored, then filtered out before synthesis ever saw it.",
    },
    failed: {
      label: "Extraction failed",
      tone: "error",
      hint: "The extraction call errored, so there was nothing to judge.",
    },
    not_extracted: {
      label: "Never extracted",
      tone: "error",
      hint: "Ingested, but no extraction row was ever written for it.",
    },
    dropped_at_ingest: {
      label: "Dropped at ingest",
      tone: "error",
      hint: "Discarded while fetching mail - it never became an item at all.",
    },
    unjudged: {
      label: "No verdict recorded",
      tone: "muted",
      hint: "Extracted before the gate kept a record, and not reconstructed since.",
    },
  };

  const meta = $derived(OUTCOME[item.outcome]);

  /**
   * The arithmetic line, when the verdict rests on a number rather than on a category. Written out
   * only where there is arithmetic to see: with no trust multiplier and no corroboration, "3.0
   * relevance = 3.00" is a sum with one term, and the bar it was compared against is the point.
   */
  function sum(extraction: TriageExtraction): string | null {
    const detail = extraction.gateDetail;
    if (!detail || detail.relevanceScore === null) return null;

    const bar = detail.threshold === undefined ? "" : `, needed ${fmtScore(detail.threshold)}`;
    // A news desk scores significance on its own scale, and nothing weights it.
    if (item.sourceType === "web_news") return `Significance ${fmtScore(detail.relevanceScore)}${bar}`;
    const weighted = detail.trustScore !== 1 || detail.corroborationBonus > 0;
    if (!weighted) return `Relevance ${fmtScore(detail.relevanceScore)}${bar}`;

    const parts = [`${fmtScore(detail.relevanceScore)} relevance`];
    if (detail.trustScore !== 1) parts.push(`x ${fmtScore(detail.trustScore, 2)} trust`);
    if (detail.corroborationBonus > 0) parts.push(`+ ${fmtScore(detail.corroborationBonus)} corroboration`);
    return `${parts.join(" ")} = ${fmtScore(detail.effectiveRelevance, 2)}${bar}`;
  }

  /**
   * A reconstructed verdict used 1.0 for a trust score it cannot know. Said once at the top of the
   * page and carried here as a tooltip: on a day where every row was backfilled, a visible line
   * per row is three hundred repetitions of the same sentence.
   */
  const RECONSTRUCTED =
    "Reconstructed from the stored extraction by scripts/backfill-gate.ts. The source trust score " +
    "of that morning is gone, so 1.0 was used in its place.";

  /** These verdicts are the classification, said in words. Repeating it after them is noise. */
  const SELF_EVIDENT = new Set(["spam", "general_news", "automated_low_urgency"]);

  /** What the classifier made of a mail, where the verdict does not already say it. */
  function classification(extraction: TriageExtraction): string | null {
    const detail = extraction.gateDetail;
    if (!detail?.emailCategory) return null;
    if (extraction.gateReason && SELF_EVIDENT.has(extraction.gateReason)) return null;
    return [displayLabel(detail.emailCategory), detail.urgency ? displayLabel(detail.urgency) : null]
      .filter(Boolean)
      .join(" - ");
  }

  const detailHref = $derived(
    item.extractions.length > 0
      ? `/${date}/detail/${item.extractions.slice(0, 10).map((e) => e.id).join(",")}`
      : null,
  );
</script>

<article class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-3 flex flex-col gap-2">
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <Badge tone={meta.tone} solid title={meta.hint}>{meta.label}</Badge>
    {#if item.sourceType === "web_news"}
      <!-- A desk is not a source with a quality history, so there is no /sources page to open. -->
      <span class="text-surface-300 truncate max-w-[14rem]">{displayLabel(item.sourceName)}</span>
    {:else if item.sourceName}
      <a href="/sources/{encodeURIComponent(item.sourceName)}" class="text-surface-300 no-underline hover:text-surface-100 truncate max-w-[14rem]">
        {item.sourceName}
      </a>
    {/if}
    {#if item.account}
      <span class="text-surface-400 truncate max-w-[12rem]">to {item.account}</span>
    {/if}
    <span class="text-surface-400 sm:ml-auto tabular-nums">{fmtDateTimeShort(item.receivedAt)}</span>
  </div>

  <h3 class="text-sm font-medium text-surface-100 leading-snug break-words">
    {item.subject ?? "(no subject)"}
  </h3>

  {#if item.sender}
    <p class="text-xs text-surface-400 break-all">From {item.sender}</p>
  {/if}

  <!-- Why it stopped where it stopped, in one sentence, for the stages that have no per-item
       verdict to show underneath. -->
  {#if item.outcome === "dropped_at_ingest"}
    <p class="text-xs text-error-400">{displayLabel(item.dropReason)}</p>
  {:else if item.outcome === "not_extracted"}
    <p class="text-xs text-error-400">
      {item.sourceActive === false
        ? "The source is switched off, so Phase 2 skipped it."
        : "No extraction row - the run did not get this far, or it was skipped."}
    </p>
  {:else if item.outcome === "unjudged"}
    <p class="text-xs text-surface-400">{meta.hint}</p>
  {/if}

  {#if item.extractions.length > 0}
    <ul class="flex flex-col divide-y divide-surface-800 border-t border-surface-800 pt-1">
      {#each item.extractions as extraction (extraction.id)}
        <li class="py-2 flex flex-col gap-1">
          <div class="flex items-start gap-2">
            <!-- The figure the gate compared, which for a reconstructed verdict is the one on
                 the verdict rather than the column. The hue repeats what the words below already
                 say (A4), so it is never carrying the meaning on its own. -->
            <span
              class="mt-0.5 shrink-0 text-xs font-semibold tabular-nums w-10 text-right
                {extraction.includedInReport
                  ? 'text-success-400'
                  : extraction.gatePassed
                    ? 'text-primary-300'
                    : 'text-surface-400'}"
            >
              <span class="sr-only">Effective relevance</span>
              {extraction.gateDetail ? fmtScore(extraction.gateDetail.effectiveRelevance, 1) : fmtScore(extraction.effectiveRelevance, 1)}
            </span>

            <div class="min-w-0 flex-1 flex flex-col gap-0.5">
              <!-- Newsletters carry a headline per story; a classified mail carries none, and its
                   subject is already the card's own title. So this stays empty rather than
                   announcing a headline that was never supposed to exist. -->
              {#if extraction.headline ?? extraction.skipReason}
                <p class="text-xs text-surface-200 break-words">
                  {extraction.headline ?? displayLabel(extraction.skipReason)}
                </p>
              {/if}

              <p class="text-xs text-surface-400">
                {#if extraction.includedInReport}
                  <span class="text-success-400">Cited in the report</span>
                {:else if extraction.gateReason}
                  {displayLabel(extraction.gateReason)}
                {:else}
                  No verdict recorded
                {/if}
                {#if classification(extraction)}
                  <span class="text-surface-400"> - {classification(extraction)}</span>
                {/if}
              </p>

              {#if sum(extraction)}
                <p
                  class="text-xs tabular-nums {extraction.gateDetail?.recordedBy === 'backfill'
                    ? 'text-surface-400 decoration-dotted underline underline-offset-4 decoration-surface-600'
                    : 'text-surface-400'}"
                  title={extraction.gateDetail?.recordedBy === "backfill" ? RECONSTRUCTED : undefined}
                >
                  {sum(extraction)}
                </p>
              {/if}

              {#if extraction.actionRequired}
                <p class="text-xs text-surface-300"><span class="text-surface-400">Action:</span> {extraction.actionRequired}</p>
              {/if}
            </div>

            {#if extraction.rating}
              <Badge tone={extraction.rating === "explicit_plus" ? "success" : "error"}>
                {extraction.rating === "explicit_plus" ? "Rated up" : "Rated down"}
              </Badge>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if detailHref}
    <a href={detailHref} class="text-xs text-primary-400 no-underline hover:text-primary-300">
      Open the original and the full extraction →
    </a>
  {/if}
</article>
