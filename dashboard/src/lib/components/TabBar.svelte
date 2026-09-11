<script lang="ts">
  /**
   * The mobile bottom bar and its More sheet (M-1, M-7).
   *
   * Four destinations - Report, Notes, Chat, More - each a full-height target, which makes this
   * the first thing in the app to satisfy the 44px minimum. Chat being a tab is also what
   * removes the floating launcher below `sm`: the panel already took the whole screen there, so
   * the button bought nothing and collided with the toast and the home indicator.
   *
   * `h-14` plus the safe-area inset, so the bar sits above the iOS home indicator rather than
   * under it.
   */
  import { page } from "$app/state";
  import { ROUTES, TABS, MORE_ICON, routeFor } from "$lib/routes";
  import NotifyButton from "$lib/components/NotifyButton.svelte";

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  let { open, onOpenChange }: Props = $props();

  const current = $derived(routeFor(page.route.id));
  const badges = $derived((page.data.navBadges ?? {}) as Record<string, number>);
  const anyPending = $derived(Object.values(badges).some((count) => count > 0));

  /** Everything the tab bar does not already reach. */
  const sheetRoutes = $derived(ROUTES.filter((route) => route.tab === undefined));

  // A navigation closes the sheet: leaving it open over the page it just opened is a trap.
  $effect(() => {
    page.url.pathname;
    onOpenChange(false);
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) onOpenChange(false);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- The scrim is a button so a tap outside closes, and so the role is honest. -->
  <button
    type="button"
    aria-label="Close menu"
    class="fixed inset-0 z-40 bg-surface-950/70 sm:hidden"
    onclick={() => onOpenChange(false)}
  ></button>

  <div
    role="dialog"
    aria-label="More"
    aria-modal="true"
    class="fixed inset-x-0 bottom-0 z-50 sm:hidden max-h-[80dvh] overflow-y-auto
           rounded-t-2xl border-t border-surface-700 bg-surface-900
           px-4 pt-3 pb-[calc(1rem+var(--safe-b))] flex flex-col gap-2 shadow-2xl"
  >
    <div class="mx-auto mb-1 h-1 w-10 rounded-full bg-surface-600" aria-hidden="true"></div>

    {#each sheetRoutes as entry (entry.href)}
      {@const badge = badges[entry.href] ?? 0}
      <a
        href={entry.href}
        aria-current={current?.href === entry.href ? "page" : undefined}
        class="tap flex items-center gap-3 rounded-lg border px-4 py-3 no-underline text-sm transition-colors
          {current?.href === entry.href
            ? 'border-primary-800 bg-primary-950 text-primary-300'
            : 'border-surface-700 bg-surface-950 text-surface-200 hover:bg-surface-800'}"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d={entry.icon} />
        </svg>
        <span class="flex-1">{entry.label}</span>
        {#if badge > 0}
          <span class="badge border border-warning-800 bg-warning-950 text-warning-400">{badge} pending</span>
        {/if}
      </a>
    {/each}

    <NotifyButton variant="row" />
  </div>
{/if}

<nav
  aria-label="Primary"
  class="sm:hidden fixed inset-x-0 bottom-0 z-30 border-t border-surface-700 bg-surface-900
         pb-[var(--safe-b)] grid grid-cols-4"
>
  {#each TABS as tab (tab.href)}
    <a
      href={tab.href}
      aria-current={current?.href === tab.href ? "page" : undefined}
      class="flex h-14 flex-col items-center justify-center gap-0.5 no-underline text-xs transition-colors
        {current?.href === tab.href ? 'text-primary-300' : 'text-surface-400'}"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d={tab.icon} />
      </svg>
      {tab.label}
    </a>
  {/each}

  <button
    type="button"
    onclick={() => onOpenChange(!open)}
    aria-expanded={open}
    class="relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs cursor-pointer bg-transparent border-none
      {open ? 'text-primary-300' : 'text-surface-400'}"
  >
    <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d={MORE_ICON} />
    </svg>
    More
    {#if anyPending}
      <span class="absolute top-2 right-1/4 h-2 w-2 rounded-full bg-warning-500" aria-hidden="true"></span>
    {/if}
  </button>
</nav>
