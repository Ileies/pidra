<script lang="ts">
  /**
   * Keyboard shortcuts, and the overlay that documents them (E1).
   *
   * This owns the global bindings so there is one place that knows what a key does - the
   * Ctrl+K collision between search and the assistant was exactly the kind of thing that happens
   * when two components each claim a key on their own.
   *
   * Desktop by nature, which is fine: the phone gets the bottom tab bar instead.
   */
  import { goto } from "$app/navigation";
  import { ROUTES } from "$lib/routes";

  interface Props {
    onOpenSearch: () => void;
    onToggleAssistant: () => void;
  }

  let { onOpenSearch, onToggleAssistant }: Props = $props();

  let overlayOpen = $state(false);
  /** Set by `g`, cleared by the next key or after a moment: `g` then a letter jumps to a page. */
  let goPending = $state(false);
  let goTimer: ReturnType<typeof setTimeout> | undefined;

  /** Declared on the registry entry, so this is still one list rather than two. */
  const GO_KEYS = $derived.by(() => {
    const map = new Map<string, { href: string; label: string }>();
    for (const route of ROUTES) {
      if (route.key) map.set(route.key, { href: route.href, label: route.label });
    }
    return map;
  });

  function isTyping(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return element.isContentEditable || /^(input|textarea|select)$/i.test(element.tagName);
  }

  function armGo() {
    goPending = true;
    clearTimeout(goTimer);
    goTimer = setTimeout(() => (goPending = false), 1500);
  }

  function onKeydown(event: KeyboardEvent) {
    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onOpenSearch();
      return;
    }
    if (meta && event.key.toLowerCase() === "j") {
      event.preventDefault();
      onToggleAssistant();
      return;
    }
    if (meta || event.altKey) return;

    if (event.key === "Escape" && overlayOpen) {
      overlayOpen = false;
      return;
    }

    if (isTyping(event.target)) return;

    if (goPending) {
      goPending = false;
      clearTimeout(goTimer);
      const target = GO_KEYS.get(event.key.toLowerCase());
      if (target) {
        event.preventDefault();
        goto(target.href);
      }
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      onOpenSearch();
    } else if (event.key === "?") {
      event.preventDefault();
      overlayOpen = !overlayOpen;
    } else if (event.key === "g") {
      armGo();
    }
  }

  const SHORTCUTS: [string, string][] = [
    ["Ctrl / Cmd + K", "Search and jump"],
    ["/", "Search and jump"],
    ["Ctrl / Cmd + J", "Open or close the assistant"],
    ["j / k", "Previous or next report day"],
    ["?", "This list"],
    ["Esc", "Close, or cancel a running turn"],
  ];
</script>

<svelte:window onkeydown={onKeydown} />

{#if goPending}
  <div class="fixed bottom-4 left-4 z-50 rounded border border-surface-600 bg-surface-800 px-3 py-1.5 text-xs text-surface-200 shadow-lg">
    g … press a page's key, or <span class="font-mono">?</span> for the list
  </div>
{/if}

{#if overlayOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" aria-label="Close shortcuts" class="absolute inset-0 bg-surface-950/80 cursor-default" onclick={() => (overlayOpen = false)}></button>

    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" class="relative w-full max-w-md rounded-lg border border-surface-600 bg-surface-900 p-5 shadow-2xl">
      <h2 class="mb-3 text-sm font-semibold text-surface-50">Keyboard shortcuts</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        {#each SHORTCUTS as [keys, what] (keys)}
          <dt class="font-mono text-surface-200 whitespace-nowrap">{keys}</dt>
          <dd class="text-surface-400">{what}</dd>
        {/each}
      </dl>

      <h3 class="mt-4 mb-2 text-xs font-semibold text-surface-200">
        <span class="font-mono">g</span> then…
      </h3>
      <ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {#each [...GO_KEYS] as [key, target] (key)}
          <li class="flex items-baseline gap-2">
            <span class="font-mono text-surface-200">{key}</span>
            <span class="text-surface-400">{target.label}</span>
          </li>
        {/each}
      </ul>

      <p class="mt-4 text-xs text-surface-400">
        Search took Ctrl+K, so the assistant is on Ctrl+J.
      </p>
    </div>
  </div>
{/if}
