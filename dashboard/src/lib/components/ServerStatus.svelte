<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import { netJson } from "#lib/offline/net.js";
  import { offline } from "#lib/offline/state.svelte.js";

  let serverOnline = $state<boolean | null>(null);

  $effect(() => {
    let active = true;

    async function check() {
      if (document.hidden) return;
      try {
        const result = await netJson<{ online: boolean }>("/api/server-status", { cache: "no-store" });
        if (active) {
          const recovered = serverOnline === false && result.online;
          serverOnline = result.online;
          if (recovered && (page.route.id === "/prompts" || page.route.id === "/sources")) {
            void invalidateAll();
          }
        }
      } catch {
        if (active) serverOnline = null;
      }
    }

    void check();
    const timer = setInterval(check, 20_000);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });
</script>

{#if serverOnline === false && offline.reachable !== "offline"}
  <div role="status" class="border-b border-warning-700 bg-warning-950 px-4 py-2 text-center text-xs text-warning-200">
    Pipeline server is offline. Reports, prompt management, and source controls may be unavailable until it returns.
  </div>
{/if}
