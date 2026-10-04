<script lang="ts">
  /**
   * The mobile bottom bar and its More sheet (M-1, M-7).
   *
   * Four destinations - Report, Notes, Chat, More - each a full-height target, which makes this
   * the first thing in the app to satisfy the 44px minimum. Chat being a tab is also what
   * removes the floating launcher below `lg`: the panel already took the whole screen there, so
   * the button bought nothing and collided with the toast and the home indicator.
   *
   * `h-14` plus the safe-area inset, so the bar sits above the iOS home indicator rather than
   * under it.
   */
  import { page } from "$app/state";
  import { ROUTES, TABS, MORE_ICON, routeFor } from "#lib/routes.js";
  import { navBadges } from "#lib/navBadges.svelte.js";
  import CountBadge from "#lib/components/CountBadge.svelte";
  import NavLink from "#lib/components/NavLink.svelte";
  import { dismissable } from "#lib/ui/dismissable.js";
  import { swipeToClose } from "#lib/ui/swipeToClose.js";

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  let { open, onOpenChange }: Props = $props();

  const current = $derived(routeFor(page.route.id));
  const badges = $derived(navBadges.counts);

  /** Everything the tab bar does not already reach, minus header-icon and settings-only pages. */
  const sheetRoutes = $derived(ROUTES.filter((route) => route.tab === undefined && !route.headerIcon && !route.hidden));
  /** What the More tab shows: the sum of the counts on the rows inside the sheet. */
  const sheetTotal = $derived(sheetRoutes.reduce((sum, entry) => sum + (badges[entry.href] ?? 0), 0));

  // A navigation closes the sheet: leaving it open over the page it just opened is a trap.
  $effect(() => {
    page.url.pathname;
    onOpenChange(false);
  });
</script>

{#if open}
  <div class="fixed inset-0 z-40 bg-(--app-scrim) lg:hidden" aria-hidden="true"></div>

  <div
    role="dialog"
    use:dismissable={{ open, onclose: () => onOpenChange(false) }}
    use:swipeToClose={() => onOpenChange(false)}
    aria-label="More"
    aria-modal="true"
    class="fixed inset-x-0 bottom-0 z-50 lg:hidden max-h-[80dvh] overflow-y-auto
           rounded-t-2xl border-t border-surface-700 bg-surface-900
           px-4 pt-3 pb-[calc(1rem+var(--safe-b))] flex flex-col gap-2 shadow-2xl"
  >
    <div class="mx-auto mb-1 h-1 w-10 rounded-full bg-surface-600" aria-hidden="true"></div>

    {#each sheetRoutes as entry (entry.href)}
      <NavLink {entry} variant="row" current={current?.href === entry.href} />
    {/each}
  </div>
{/if}

<nav
  aria-label="Primary"
  class="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-surface-700 bg-surface-900
         pb-[var(--safe-b)] grid grid-cols-4"
>
  {#each TABS as tab (tab.href)}
    <NavLink entry={tab} variant="tab" current={current?.href === tab.href} />
  {/each}

  <button
    type="button"
    onclick={() => onOpenChange(!open)}
    aria-expanded={open}
    aria-label={sheetTotal > 0 ? `More, ${sheetTotal} waiting for you` : undefined}
    class="relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs bg-transparent border-none
      {open ? 'text-primary-300' : 'text-surface-400'}"
  >
    <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
      <path d={MORE_ICON} />
    </svg>
    More
    <CountBadge count={sheetTotal} class="absolute top-1 left-1/2 ml-1" />
  </button>
</nav>
