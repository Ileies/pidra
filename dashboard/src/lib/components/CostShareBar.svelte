<script lang="ts">
  /** A stacked bar of each phase's share of a run's spend (or tokens, when nothing is priced). Same size and shape as `TimelineBar`. */
  import { fmtCost, fmtNum } from "#lib/format.js";
  import { PRICING_CONFIGURED } from "#lib/pricing.js";
  import { groupInfo, type GroupId } from "#lib/runTrace.js";

  interface Props {
    entries: readonly { group: GroupId; weight: number }[];
  }

  let { entries }: Props = $props();

  const shown = $derived(entries.filter((entry) => entry.weight > 0));
  const sum = $derived(shown.reduce((total, entry) => total + entry.weight, 0));
</script>

<div class="flex h-4 w-full overflow-hidden rounded bg-surface-800" role="img" aria-label="Cost share by phase">
  {#each shown as entry (entry.group)}
    <span
      class="h-full min-w-[2px]"
      style="width:{(entry.weight / sum) * 100}%;background:{groupInfo(entry.group).color}"
      title="{groupInfo(entry.group).label}: {PRICING_CONFIGURED ? fmtCost(entry.weight) : `${fmtNum(entry.weight)} tokens`}"
    ></span>
  {/each}
</div>
