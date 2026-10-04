<script lang="ts">
  /** The active corrections beside the transcript: what the assistant has been told outranks the harvest. */
  import Badge from "#lib/components/Badge.svelte";
  import { label } from "#lib/labels.js";

  interface Correction {
    id: string;
    target_kind: string;
    operation: string;
    statement: string;
    supersedes_text: string | null;
  }

  let { corrections }: { corrections: Correction[] } = $props();
</script>

<div class="rounded-lg border border-surface-800 bg-surface-900 p-4 flex flex-col gap-3 min-h-0">
  <h2 class="text-surface-400 text-xs font-semibold uppercase tracking-wide shrink-0">Active corrections</h2>
  {#if corrections.length === 0}
    <p class="text-surface-400 text-xs">None yet.</p>
  {:else}
    <div class="flex flex-col gap-2 overflow-y-auto min-h-0">
      {#each corrections as correction (correction.id)}
        <div class="rounded-lg border border-surface-800 bg-surface-950 px-3 py-2 text-xs">
          <div class="flex items-center gap-1.5 flex-wrap">
            <Badge tone="primary">{label(correction.target_kind)}</Badge>
            <Badge tone="muted">{label(correction.operation)}</Badge>
          </div>
          <div class="text-surface-200 mt-1.5 break-words">{correction.statement}</div>
          {#if correction.supersedes_text}
            <div class="text-surface-500 mt-1 line-through break-words">{correction.supersedes_text}</div>
          {/if}
        </div>
      {/each}
    </div>
    <a href="/context-builder" class="text-surface-400 text-xs hover:text-surface-200 shrink-0">See all and revert →</a>
  {/if}
</div>
