<script lang="ts" module>
  export function pct(value: number): string {
    return `${(value * 100).toFixed(3)}%`;
  }
</script>

<script lang="ts">
  /** One traced step as a label line over a bar placed on the run's time scale. */
  import { fmtMs } from "#lib/format.js";
  import { groupInfo, stepLabel, type SpanNode, type TimeScale } from "#lib/runTrace.js";

  interface Props {
    node: SpanNode;
    scale: TimeScale;
  }

  let { node, scale }: Props = $props();

  const style = $derived.by(() => {
    const left = scale.at(node.offsetMs);
    const right = scale.at(node.offsetMs + node.lengthMs);
    return `left:${pct(left)};width:max(3px, ${pct(Math.max(0, right - left))});background:${groupInfo(node.group).color}`;
  });
</script>

<span class="flex items-baseline gap-2 text-xs min-w-0" style="padding-left:{Math.min(node.depth - 1, 4) * 0.75}rem">
  <span class="text-surface-200 truncate min-w-0">{stepLabel(node.step)}</span>
  {#if node.attempt > 1}
    <span class="text-surface-400 shrink-0">attempt {node.attempt}</span>
  {/if}
  {#if node.status === "failed"}
    <span class="text-error-400 shrink-0">failed</span>
  {:else if node.status === "running"}
    <span class="text-primary-400 shrink-0">unfinished</span>
  {/if}
  <span class="ml-auto text-surface-400 tabular-nums shrink-0">{fmtMs(node.lengthMs)}</span>
</span>
<span class="relative block h-2.5 rounded bg-surface-800 overflow-hidden">
  <span
    class="absolute top-0 h-full rounded {node.status === 'failed' ? 'outline outline-2 -outline-offset-2 outline-error-500' : ''}"
    {style}
  ></span>
</span>
