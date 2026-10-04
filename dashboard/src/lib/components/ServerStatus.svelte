<script lang="ts">
  import { netJson } from "#lib/offline/net.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { poll } from "#lib/offline/poll.js";

  let serverOnline = $state<boolean | null>(null);

  async function check() {
    try {
      const result = await netJson<{ online: boolean }>("/api/server-status", { cache: "no-store" });
      serverOnline = result.online;
    } catch {
      serverOnline = null;
    }
  }

  $effect(() => poll(check, 20_000, { immediate: true }));
</script>

{#if serverOnline === false && offline.reachable !== "offline"}
  <div role="status" class="border-b border-warning-700 bg-warning-950 px-4 py-2 text-center text-xs text-warning-200">
    Pipeline server is offline. Actions that need it, including prompt and source changes, are unavailable until it returns.
  </div>
{/if}
