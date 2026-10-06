<script lang="ts">
  // Jev calls of one run from the evaluation ledger, per task and mode (`/runs/[id]`). Separate from
  // the run's own model calls and cost, which mix other providers.
  import Card from "#lib/components/Card.svelte";
  import { fmtMs, fmtNum } from "#lib/format.js";
  import type { JevTaskSummary } from "../../routes/runs/[id]/+page.server";

  let { rows }: { rows: JevTaskSummary[] } = $props();
</script>

{#if rows.length > 0}
<Card class="px-4 py-3 flex flex-col gap-2">
  <div class="text-sm font-medium text-surface-100">Jev decisions</div>
  <p class="text-xs text-surface-400 max-w-prose">
    From the evaluation ledger, separate from the run's model calls and cost above.
  </p>
  <div class="overflow-x-auto">
    <table class="w-full text-xs tabular-nums">
      <thead>
        <tr class="text-left text-surface-400">
          <th class="py-1 pr-3 font-normal">Task</th>
          <th class="py-1 pr-3 font-normal">Mode</th>
          <th class="py-1 pr-3 font-normal text-right">Calls</th>
          <th class="py-1 pr-3 font-normal text-right">Failed</th>
          <th class="py-1 pr-3 font-normal text-right">Tokens in</th>
          <th class="py-1 pr-3 font-normal text-right">Avg / max</th>
          <th class="py-1 font-normal text-right">Used</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.task + row.mode)}
          <tr class="border-t border-surface-700">
            <td class="py-1 pr-3 text-surface-200">{row.task}</td>
            <td class="py-1 pr-3 text-surface-300">{row.mode}</td>
            <td class="py-1 pr-3 text-right">{fmtNum(row.calls)}</td>
            <td class="py-1 pr-3 text-right {row.failures > 0 ? 'text-warning-400' : ''}">
              {fmtNum(row.failures)}{#if row.errorCodes.length > 0} <span class="font-mono">({row.errorCodes.join(", ")})</span>{/if}
            </td>
            <td class="py-1 pr-3 text-right">{fmtNum(row.tokensIn)}</td>
            <td class="py-1 pr-3 text-right">{fmtMs(row.avgLatencyMs)} / {fmtMs(row.maxLatencyMs)}</td>
            <td class="py-1 text-right">{fmtNum(row.influenced)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</Card>
{/if}
