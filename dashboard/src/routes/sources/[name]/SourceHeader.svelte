<script lang="ts">
  /** What the score is, and the one decision this page exists to support. */
  import Badge from "#lib/components/Badge.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import { fmtDate, fmtScore, scoreTone } from "#lib/format.js";
  import { label as displayLabel, TREND_GLYPH } from "#lib/labels.js";

  interface Props {
    name: string;
    stats: { deliveries: number; items: number; firstSeen: string | null; lastSeen: string | null };
    quality: {
      is_active: boolean | null;
      disabled_reason: string | null;
      disabled_at: string | null;
      composite_score_30d: number | null;
      quality_trend: string | null;
    } | null;
  }

  let { name, stats, quality }: Props = $props();
  const isActive = $derived(quality?.is_active !== false);
</script>

<section class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
  <div class="flex flex-col gap-1 min-w-0">
    <div class="flex items-center gap-2 flex-wrap">
      <a href="/sources" class="text-xs text-surface-400 hover:text-surface-200 no-underline">← Sources</a>
    </div>
    <div class="flex items-center gap-2 flex-wrap">
      <h1 class="text-lg font-semibold text-surface-50 break-words">{name}</h1>
      {#if !isActive}<Badge tone="muted">Disabled</Badge>{/if}
    </div>
    <p class="text-xs text-surface-400">
      {stats.deliveries} deliveries, {stats.items} items
      {#if stats.firstSeen}· since {fmtDate(stats.firstSeen)}{/if}
      {#if stats.lastSeen}· last {fmtDate(stats.lastSeen)}{/if}
    </p>
    {#if !isActive && quality?.disabled_reason}
      <p class="text-xs text-surface-400">
        Reason: <span class="text-surface-200">{quality.disabled_reason}</span>
        {#if quality.disabled_at}({fmtDate(quality.disabled_at)}){/if}
      </p>
    {/if}
  </div>

  <div class="flex items-center gap-4 shrink-0">
    <div class="text-right">
      <div class="text-2xl font-semibold tabular-nums {scoreTone(quality?.composite_score_30d)}">
        {fmtScore(quality?.composite_score_30d)}<span class="text-xs text-surface-400 ml-px">/10</span>
      </div>
      <div class="text-xs text-surface-400 whitespace-nowrap">
        <span aria-hidden="true">{TREND_GLYPH[quality?.quality_trend ?? "stable"] ?? "→"}</span>
        {displayLabel(quality?.quality_trend ?? "stable")}
      </div>
    </div>

    {#if !isActive}
      <ConfirmButton label="Enable" action="?/toggle" fields={{ isActive: "true" }} tone="success" immediate />
    {/if}
  </div>
</section>
