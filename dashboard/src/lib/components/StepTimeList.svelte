<script lang="ts">
  /** The run page's "Details" list: each traced step with its duration right after the name. */
  import { fmtMs } from "#lib/format.js";
  import { groupInfo, stepLabel, type SpanNode } from "#lib/runTrace.js";
  import { stepHint } from "#lib/runStepHints.js";

  interface Props {
    nodes: readonly SpanNode[];
  }

  let { nodes }: Props = $props();
</script>

<ul class="mt-2 flex flex-col gap-1">
  {#each nodes as node (node.id)}
    {@const hint = stepHint(node.step)}
    <li
      class="flex items-baseline gap-2 text-xs min-w-0"
      style="padding-left:{Math.min(node.depth - 1, 4) * 0.75}rem"
      title="Starts at +{fmtMs(node.offsetMs)}"
    >
      <span class="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style="background:{groupInfo(node.group).color}"></span>
      {#if hint}
        <span
          class="text-surface-200 min-w-0 cursor-help underline decoration-dashed decoration-surface-500 underline-offset-4"
          title={hint}
        >{stepLabel(node.step)}<span class="ml-0.5 text-surface-400" aria-hidden="true">?</span></span>
      {:else}
        <span class="text-surface-200 min-w-0">{stepLabel(node.step)}</span>
      {/if}
      <span class="text-surface-100 font-medium tabular-nums shrink-0">{fmtMs(node.lengthMs)}</span>
      {#if node.attempt > 1}<span class="text-surface-400 shrink-0">attempt {node.attempt}</span>{/if}
      {#if node.status === "failed"}
        <span class="text-error-400 shrink-0">failed</span>
      {:else if node.status === "running"}
        <span class="text-primary-400 shrink-0">unfinished</span>
      {/if}
    </li>
  {/each}
</ul>
