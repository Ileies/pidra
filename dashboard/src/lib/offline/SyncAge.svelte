<script lang="ts">
  // Every mirrored page shows the mirror's age; past a day it becomes the warning.
  import { offline } from "./state.svelte.js";
  import { fmtAge, fmtDateTime } from "#lib/format.js";

  const STALE_MS = 24 * 3600_000;

  const age = $derived(offline.lastSyncedAt ? offline.now - new Date(offline.lastSyncedAt).getTime() : null);
</script>

{#if age !== null && offline.lastSyncedAt}
  {#if age > STALE_MS}
    <p role="status" class="rounded-lg border border-warning-800 bg-warning-950 px-3 py-2 text-xs text-warning-400">
      Offline copy, synced {fmtAge(age)} ({fmtDateTime(offline.lastSyncedAt)}).
      {offline.reachable === "offline" ? "Reconnect to the VPN to refresh it." : offline.syncing ? "Refreshing…" : ""}
    </p>
  {:else}
    <p class="text-xs text-surface-400 text-right" title={fmtDateTime(offline.lastSyncedAt)}>
      Synced {fmtAge(age)}{offline.syncing ? " · refreshing" : ""}
    </p>
  {/if}
{/if}
