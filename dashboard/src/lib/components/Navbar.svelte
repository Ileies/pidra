<script lang="ts">
  /**
   * The one navbar. Mounted once by the root layout and never torn down, so clicking a link
   * swaps only the page below it. Anything route-dependent derives from `page`, never from a
   * prop: a prop would let each page decide what the header looks like, which is the problem
   * this component exists to remove.
   *
   * Two forms (entries come from `ROUTES` in `lib/routes.ts`; see docs/dashboard.md "Navigation"):
   *
   * - **`lg` (1024px) and up:** one row showing only the non-`secondary` entries; the rest sit
   *   behind a "More" menu of tiles, each with its own count, the button showing the sum. The
   *   row would not fit on one line below `lg`, and between `lg` and `xl` it is compacted
   *   (smaller padding, wordmark hidden) to still fit at 1024px. Settings is an icon-only button.
   * - **Below `lg`:** only icon, page title, sync state and settings stay here; navigation is
   *   `TabBar` and its More sheet.
   *
   * Badge counts come from `navBadges` (`/api/nav-badges`), keyed by href. Log out, passkeys and
   * the legal pages live in /settings.
   */
  import { page } from "$app/state";
  import { afterNavigate } from "$app/navigation";
  import { ROUTES, NAV_GROUPS, routeFor, type RouteDef } from "#lib/routes.js";
  import SyncLogo from "#lib/offline/SyncLogo.svelte";
  import { navBadges } from "#lib/navBadges.svelte.js";
  import { appUpdate } from "#lib/offline/update.svelte.js";
  import CountBadge from "#lib/components/CountBadge.svelte";
  import NavLink from "#lib/components/NavLink.svelte";
  import UpdateBanner from "#lib/components/UpdateBanner.svelte";
  import { dismissable } from "#lib/ui/dismissable.js";

  const routeId = $derived(page.route.id ?? "");
  const current = $derived(routeFor(routeId));
  /** Keyed by href, so the navbar renders a badge without knowing what it counts. */
  const badges = $derived(navBadges.counts);
  const settings = ROUTES.find((route) => route.href === "/settings");

  /**
   * Two routes name the thing on screen better than a static label does: the report is its
   * date, the source detail is the source.
   */
  const subtitle = $derived(
    routeId === "/[date]"
      ? (page.params.date ?? "")
      : routeId === "/[date]/detail/[ids]"
        ? `${page.params.date} · Detail`
        : routeId === "/sources/[name]" && page.params.name
          ? decodeURIComponent(page.params.name)
          : (current?.label ?? ""),
  );

  const visible = $derived(ROUTES.filter((route) => !route.hidden && !route.headerIcon));
  const byGroup = $derived(
    NAV_GROUPS.map((group) => visible.filter((route) => route.group === group && !route.secondary)).filter(
      (list) => list.length > 0,
    ),
  );
  /** Everything folded into "More", in registry order rather than re-grouped. */
  const overflow = $derived(visible.filter((route) => route.secondary));
  /** What the More button shows: the sum of the counts on the tiles inside it, so the two always agree. */
  const overflowTotal = $derived(overflow.reduce((sum, entry) => sum + (badges[entry.href] ?? 0), 0));

  let moreOpen = $state(false);

  // A navigation closes the menu: leaving it open over the page it just opened is a trap (as in TabBar's sheet).
  afterNavigate(() => {
    moreOpen = false;
  });

  function isCurrentEntry(entry: RouteDef): boolean {
    return current?.href === entry.href;
  }
</script>

<header
  data-app-header
  class="sticky top-0 z-30 bg-transparent
         pt-[var(--safe-t)] pl-[var(--safe-l)] pr-[var(--safe-r)]"
>
  <div class="relative flex items-center gap-3 px-4 sm:px-6 lg:px-8 py-2">
    <!-- The logo is the sync control; the wordmark next to it is the way home. Between `lg` and `xl`
         the wordmark is hidden and the Report button in the row is the way home instead. -->
    <div class="flex items-center gap-1 shrink-0">
      <SyncLogo />
      <a href="/" class="font-bold tracking-widest text-lg text-surface-50 no-underline hover:opacity-90 transition-opacity lg:max-xl:hidden">PIDRA<span class="sr-only"> - home</span></a>
    </div>

    {#if subtitle}
      <span class="text-surface-400 text-sm truncate min-w-0 {appUpdate.ready ? 'md:max-w-[11rem]' : ''}">{subtitle}</span>
    {/if}

    {#if appUpdate.ready}
      <UpdateBanner />
    {/if}

    <!-- Desktop: the primary entries, then everything secondary behind one menu. Settings follows, last. -->
    <nav aria-label="Main" class="hidden lg:flex items-center justify-end gap-3 lg:ml-auto">
      {#each byGroup as group (group[0].href)}
        {#each group as entry (entry.href)}
          <NavLink {entry} variant="icon" current={isCurrentEntry(entry)} />
        {/each}
      {/each}

      {#if overflow.length > 0}
        <div class="relative" use:dismissable={{ open: moreOpen, onclose: () => (moreOpen = false) }}>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="true"
            aria-label={overflowTotal > 0 ? `More pages: ${overflowTotal} waiting for you` : "More pages"}
            onclick={() => (moreOpen = !moreOpen)}
            class="tap relative flex h-10 w-10 items-center justify-center rounded-lg border border-surface-700 bg-surface-950 text-surface-300 hover:border-surface-500 hover:text-surface-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
              <path d="M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01" />
            </svg>
            <CountBadge count={overflowTotal} class="absolute -right-2 -top-2 border-2 border-surface-900" />
          </button>

          {#if moreOpen}
            <ul class="absolute right-0 z-20 mt-2 grid w-[22rem] max-w-[calc(100vw-2rem)] grid-cols-3 gap-1 overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900 p-3 shadow-2xl">
              {#each overflow as entry (entry.href)}
                <li class="min-w-0">
                  <NavLink {entry} variant="tile" current={isCurrentEntry(entry)} onclick={() => (moreOpen = false)} />
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </nav>

    <a
      href="/settings"
      aria-label="Settings"
      aria-current={current?.href === "/settings" ? "page" : undefined}
      class="tap {appUpdate.ready ? 'md:ml-auto' : 'ml-auto'} lg:ml-0 flex h-10 w-10 items-center justify-center rounded-lg border no-underline transition-colors
        {current?.href === '/settings'
          ? 'border-primary-800 bg-primary-950 text-primary-300'
          : 'border-surface-700 bg-surface-950 text-surface-300 hover:border-surface-500 hover:text-surface-100'}"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={settings?.icon} />
      </svg>
    </a>

  </div>
</header>
