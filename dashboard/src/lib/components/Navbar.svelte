<script lang="ts">
  /**
   * The one navbar. Mounted once by the root layout and never torn down, so clicking a link
   * swaps only the page below it. Anything route-dependent derives from `page`, never from a
   * prop: a prop would let each page decide what the header looks like, which is the problem
   * this component exists to remove.
   *
   * Two forms (M-1):
   *
   * - **`lg` and up:** one horizontal row, grouped rather than flat. Ten to twelve controls in
   *   a single ungrouped row was the cause of the mobile header, and it was not much of a
   *   desktop layout either. Now the row only ever shows a page's `secondary: false` entries -
   *   the rest live behind one "More" menu, a grid of tiles that each carry their own red count;
   *   the button shows the sum. `lg` (1024px) rather than `sm`: below that the ten-to-twelve pills
   *   do not fit in one line even grouped, and a wrapped row squeezed the page title down to a
   *   few truncated characters on anything narrower than roughly 1100px - a common laptop width.
   *   Between `lg` and `xl` the row is compacted instead (smaller pill padding, tighter gaps, the
   *   wordmark hidden next to the icon) so it still fits on one line at 1024px.
   * - **Below `lg`:** the app icon, page title, sync state and settings stay in the header (as does
   *   settings at `lg` and up, as an icon-only button, never a pill in the row). Navigation lives
   *   in the bottom tab bar and its More sheet, so there is one predictable, thumb-reachable place
   *   to open it.
   *
   * The day steppers are gone from here. They were only ever on one route, they were the two
   * controls that pushed the row over, and they belong next to the date they step.
   *
   * Log out, passkeys and the legal pages live in /settings. There is no notifications page: an
   * unread report, an open question and an unreviewed run each count on the page they belong to.
   */
  import { page } from "$app/state";
  import { ROUTES, NAV_GROUPS, needsConnection, routeFor, type NavGroup, type RouteDef } from "#lib/routes.js";
  import SyncLogo from "#lib/offline/SyncLogo.svelte";
  import { offline } from "#lib/offline/state.svelte.js";
  import { navBadges } from "#lib/navBadges.svelte.js";
  import { appUpdate } from "#lib/offline/update.svelte.js";
  import CountBadge from "#lib/components/CountBadge.svelte";

  const routeId = $derived(page.route.id ?? "");
  const current = $derived(routeFor(routeId));
  /** Keyed by href, so the navbar renders a badge without knowing what it counts. */
  const badges = $derived(navBadges.counts);

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

  const GROUPS: NavGroup[] = NAV_GROUPS;
  const visible = $derived(ROUTES.filter((route) => !route.hidden && !route.headerIcon));
  const byGroup = $derived(
    GROUPS.map((group) => visible.filter((route) => route.group === group && !route.secondary)).filter(
      (list) => list.length > 0,
    ),
  );
  /** Everything folded into "More", in registry order rather than re-grouped: six items is a list, not a menu. */
  const overflow = $derived(visible.filter((route) => route.secondary));
  /** What the More button shows: the sum of the counts on the tiles inside it, so the two always agree. */
  const overflowTotal = $derived(overflow.reduce((sum, entry) => sum + (badges[entry.href] ?? 0), 0));

  let moreOpen = $state(false);

  // A navigation closes the menu: leaving it open over the page it just opened is a trap (as in TabBar's sheet).
  $effect(() => {
    routeId;
    moreOpen = false;
  });

  function isCurrentEntry(entry: RouteDef): boolean {
    return current?.href === entry.href;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && moreOpen) moreOpen = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

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
      <!-- Never automatic: taking over mid-read would reload the page under the reader. -->
      <!-- From `md` up it hangs from the top edge of the screen as a tab: a body with a curved shoulder
           on each side that sweeps out to the edge at a shallow angle and drops steeply into the box.
           The pieces are opaque and the wrapper carries the opacity, so the seams never show. -->
      <div role="status" class="flex shrink-0 items-center gap-2 text-xs text-surface-200 max-md:ml-auto md:fixed md:left-1/2 md:top-0 md:z-10 md:h-12 md:-translate-x-1/2 md:gap-0 md:opacity-95 md:drop-shadow-[0_6px_12px_rgb(0_0_0/0.4)]">
        <svg viewBox="0 0 64 48" class="hidden h-12 w-16 shrink-0 -mr-px overflow-visible md:block" aria-hidden="true">
          <path d="M0 0C18 0 30 5 35 22L39 38C41 45 45 48 53 48H64V0Z" class="fill-surface-900" />
          <path d="M0 0C18 0 30 5 35 22L39 38C41 45 45 47.5 53 47.5H64" fill="none" class="stroke-surface-600" />
        </svg>
        <div class="contents md:flex md:h-full md:items-center md:gap-3 md:px-2 md:border-b md:border-surface-600 md:bg-surface-900">
        <span class="hidden md:inline">A new version of PIDRA is ready.</span>
        <!-- Below `md` there is no room for a sentence: the button shrinks to a refresh icon with a
             dot, the same 40px square as Settings, and the title row truncates a little more. -->
        <button
          type="button"
          onclick={() => appUpdate.apply()}
          aria-label="Reload: a new version of PIDRA is ready"
          title="A new version of PIDRA is ready"
          class="tap relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-primary-700 bg-primary-900 text-primary-200 hover:bg-primary-800 md:h-auto md:w-auto md:rounded md:px-3 md:py-1"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5 md:hidden" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
          </svg>
          <span class="hidden md:inline">Reload</span>
          <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-primary-400 ring-2 ring-surface-950 md:hidden" aria-hidden="true"></span>
        </button>
        </div>
        <svg viewBox="0 0 64 48" class="hidden h-12 w-16 shrink-0 -ml-px -scale-x-100 overflow-visible md:block" aria-hidden="true">
          <path d="M0 0C18 0 30 5 35 22L39 38C41 45 45 48 53 48H64V0Z" class="fill-surface-900" />
          <path d="M0 0C18 0 30 5 35 22L39 38C41 45 45 47.5 53 47.5H64" fill="none" class="stroke-surface-600" />
        </svg>
      </div>
    {/if}

    <!-- Desktop: the primary entries, then everything secondary behind one menu. Settings follows, last. -->
    <nav aria-label="Main" class="hidden lg:flex items-center justify-end gap-3 lg:ml-auto">
      {#each byGroup as group (group[0].href)}
        {#each group as entry (entry.href)}
          {@const badge = badges[entry.href] ?? 0}
          {@const unavailable = offline.isOffline && needsConnection(entry)}
          <!-- Offline, a page that needs the connection stays tappable - it opens OfflineNotice in
               the same frame - but it looks it, and it no longer preloads on hover or touch. -->
          <a
            href={entry.href}
            aria-current={isCurrentEntry(entry) ? "page" : undefined}
            data-sveltekit-preload-data={unavailable ? "off" : undefined}
            title={unavailable ? `${entry.label} (needs the connection)` : entry.label}
            aria-label={`${entry.label}${unavailable ? " (needs the connection)" : ""}${badge > 0 ? `, ${badge} waiting for you` : ""}`}
            class="tap relative flex h-10 w-10 items-center justify-center rounded-lg border no-underline transition-colors
              {isCurrentEntry(entry)
                ? 'border-primary-800 bg-primary-950 text-primary-300'
                : unavailable
                  ? 'border-dashed border-surface-700 bg-surface-950 text-surface-500 hover:text-surface-300'
                  : 'border-surface-700 bg-surface-950 text-surface-300 hover:border-surface-500 hover:text-surface-100'}"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d={entry.icon} />
            </svg>
            <CountBadge count={badge} class="absolute -right-2 -top-2 border-2 border-surface-900" />
          </a>
        {/each}
      {/each}

      {#if overflow.length > 0}
        <div class="relative">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="true"
            aria-label={overflowTotal > 0 ? `More pages: ${overflowTotal} waiting for you` : "More pages"}
            onclick={() => (moreOpen = !moreOpen)}
            class="tap relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-surface-700 bg-surface-950 text-surface-300 hover:border-surface-500 hover:text-surface-100 transition-colors"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
              <path d="M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01" />
            </svg>
            <CountBadge count={overflowTotal} class="absolute -right-2 -top-2 border-2 border-surface-900" />
          </button>

          {#if moreOpen}
            <!-- Closes on a tap anywhere else, same as the report's jump list. -->
            <button
              type="button"
              aria-label="Close the More menu"
              class="fixed inset-0 z-10 cursor-default"
              onclick={() => (moreOpen = false)}
            ></button>
            <ul class="absolute right-0 z-20 mt-2 grid w-[22rem] max-w-[calc(100vw-2rem)] grid-cols-3 gap-1 overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900 p-3 shadow-2xl">
              {#each overflow as entry (entry.href)}
                {@const badge = badges[entry.href] ?? 0}
                {@const unavailable = offline.isOffline && needsConnection(entry)}
                <li class="min-w-0">
                  <a
                    href={entry.href}
                    aria-current={isCurrentEntry(entry) ? "page" : undefined}
                    data-sveltekit-preload-data={unavailable ? "off" : undefined}
                    title={unavailable ? "Needs the connection" : undefined}
                    onclick={() => (moreOpen = false)}
                    class="relative flex flex-col items-center gap-2 rounded-xl px-2 py-4 text-center text-xs no-underline transition-colors
                      {isCurrentEntry(entry) ? 'text-primary-300 bg-surface-800' : unavailable ? 'text-surface-500 hover:bg-surface-800' : 'text-surface-200 hover:bg-surface-800'}"
                  >
                    <svg viewBox="0 0 24 24" class="h-10 w-10 shrink-0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d={entry.icon} />
                    </svg>
                    <span class="w-full truncate">{entry.label}</span>
                    {#if unavailable}
                      <span class="sr-only">(needs the connection)</span>
                    {:else if badge > 0}
                      <CountBadge count={badge} class="absolute right-2 top-2" />
                      <span class="sr-only">{badge} waiting for you</span>
                    {/if}
                  </a>
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
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </a>

  </div>
</header>
