<script lang="ts">
  /**
   * A skill call's parameters for review: short values inline, long or multi-line strings (a whole
   * prompt in `propose_prompt_version`) in a wrapping, height-capped box so nothing scrolls sideways.
   * `JsonBlock` is the compact variant for places that only need a glance.
   */
  interface Props {
    value: Record<string, unknown>;
  }

  let { value }: Props = $props();

  const entries = $derived(Object.entries(value));
  const isLong = (v: unknown): v is string => typeof v === "string" && (v.length > 80 || v.includes("\n"));
</script>

<dl class="flex flex-col gap-2 text-xs">
  {#each entries as [key, v] (key)}
    <div class="flex flex-col gap-1 min-w-0">
      <dt class="font-mono text-surface-400">{key}</dt>
      <dd class="min-w-0">
        {#if isLong(v)}
          <pre class="whitespace-pre-wrap break-words max-h-96 overflow-y-auto text-surface-200 bg-surface-950 border border-surface-800 rounded px-3 py-2">{v}</pre>
        {:else}
          <span class="font-mono text-surface-200 break-all">{typeof v === "string" ? v : JSON.stringify(v)}</span>
        {/if}
      </dd>
    </div>
  {/each}
</dl>
