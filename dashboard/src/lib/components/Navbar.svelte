<script lang="ts">
  /**
   * The one navbar. Mounted once by the root layout and never torn down, so clicking a link
   * swaps only the page below it. Anything route-dependent derives from `page`, never from a
   * prop: a prop would let each page decide what the header looks like, which is the problem
   * this component exists to remove.
   *
   * Two forms (M-1):
   *
   * - **`xl` and up:** one horizontal row, grouped rather than flat. Ten to twelve controls in
   *   a single ungrouped row was the cause of the mobile header, and it was not much of a
   *   desktop layout either. Now the row only ever shows a page's `secondary: false` entries -
   *   the rest, plus the badges they may carry, live behind one "More" menu, the same cutoff
   *   the mobile sheet uses. `xl` (1280px) rather than `sm`: below that the ten-to-twelve pills
   *   do not fit in one line even grouped, and a wrapped row squeezed the page title down to a
   *   few truncated characters on anything narrower than roughly 1100px - a common laptop width.
   * - **Below `xl`:** the app icon, page title, sync state, notifications and settings stay in
   *   the header. Navigation lives in the bottom tab bar and its More sheet, so there is one
   *   predictable, thumb-reachable place to open it.
   *
   * The day steppers are gone from here. They were only ever on one route, they were the two
   * controls that pushed the row over, and they belong next to the date they step.
   *
   * Log out, passkeys and the legal pages live in /settings. Notifications stay in the header so
   * new briefings, questions, and pipeline issues are always one tap away.
   */
  import { page } from "$app/state";
  import { ROUTES, NAV_GROUPS, needsConnection, routeFor, type NavGroup, type RouteDef } from "#lib/routes.js";
  import SyncIndicator from "#lib/offline/SyncIndicator.svelte";
  import { offline } from "#lib/offline/state.svelte.js";
  import { navBadges } from "#lib/navBadges.svelte.js";

  const routeId = $derived(page.route.id ?? "");
  const current = $derived(routeFor(routeId));
  /** Keyed by href, so the navbar renders a badge without knowing what it counts. */
  const badges = $derived(navBadges.counts);
  const notificationCount = $derived(badges["/notifications"] ?? 0);
  const isOffline = $derived(offline.reachable === "offline");

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
  const visible = $derived(ROUTES.filter((route) => !route.hidden));
  const byGroup = $derived(
    GROUPS.map((group) => visible.filter((route) => route.group === group && !route.secondary)).filter(
      (list) => list.length > 0,
    ),
  );
  /** Everything folded into "More", in registry order rather than re-grouped: six items is a list, not a menu. */
  const overflow = $derived(visible.filter((route) => route.secondary));

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
  class="sticky top-0 z-30 bg-surface-900 border-b border-surface-700
         pt-[var(--safe-t)] pl-[var(--safe-l)] pr-[var(--safe-r)]"
>
  <div class="flex items-center gap-3 px-4 sm:px-6 lg:px-8 py-2">
    <a href="/" class="flex items-center gap-1.5 no-underline hover:opacity-90 transition-opacity shrink-0">
      <img src="/icons/icon.svg" alt="" class="h-8 w-8 drop-shadow-[0_0_3px_rgba(120,157,104,0.55)]" />
      <span class="font-bold tracking-widest text-lg text-surface-50">PIDRA</span>
      <span class="sr-only">- home</span>
    </a>

    {#if subtitle}
      <span class="text-surface-400 text-sm truncate min-w-0">{subtitle}</span>
    {/if}

    <SyncIndicator />

    <a
      href="/notifications"
      aria-label={notificationCount > 0 ? `Notifications: ${notificationCount} waiting` : "Notifications"}
      class="tap relative ml-auto flex h-10 w-10 items-center justify-center rounded-lg border border-surface-700 bg-surface-950 text-surface-300 no-underline hover:border-surface-500 hover:text-surface-100 transition-colors"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {#if notificationCount > 0}
        <span class="absolute -right-1 -top-1 min-w-5 rounded-full border-2 border-surface-900 bg-error-600 px-1 text-center text-[10px] font-bold leading-5 text-white tabular-nums" aria-hidden="true">{notificationCount > 99 ? "99+" : notificationCount}</span>
      {/if}
    </a>

    <a
      href="/settings"
      aria-label="Settings"
      class="tap xl:hidden flex h-10 w-10 items-center justify-center rounded-lg border border-surface-700 bg-surface-950 text-surface-300 no-underline hover:border-surface-500 hover:text-surface-100 transition-colors"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </a>

    <!-- Desktop: the primary entries, grouped, plus everything secondary behind one menu. -->
    <nav aria-label="Main" class="hidden xl:flex items-center justify-end gap-2 flex-wrap">
      {#each byGroup as group, index (group[0].href)}
        {#if index > 0}
          <span class="w-px h-4 bg-surface-700 mx-0.5" aria-hidden="true"></span>
        {/if}
        {#each group as entry (entry.href)}
          {@const badge = badges[entry.href] ?? 0}
          {@const unavailable = isOffline && needsConnection(entry)}
          <!-- Offline, a page that needs the connection stays tappable - it opens OfflineNotice in
               the same frame - but it looks it, and it no longer preloads on hover or touch. -->
          <a
            href={entry.href}
            aria-current={isCurrentEntry(entry) ? "page" : undefined}
            data-sveltekit-preload-data={unavailable ? "off" : undefined}
            title={unavailable ? "Needs the connection" : undefined}
            class="nav-btn {isCurrentEntry(entry)
              ? 'nav-btn-active'
              : unavailable
                ? 'nav-btn-muted border-dashed'
                : badge > 0
                  ? 'border-warning-700 text-warning-400 hover:bg-surface-800'
                  : 'nav-btn-idle'}"
          >
            {entry.label}{#if badge > 0}<span class="ml-1 tabular-nums">({badge})</span><span class="sr-only"> waiting for you</span>{/if}{#if unavailable}<span class="sr-only"> (needs the connection)</span>{/if}
          </a>
        {/each}
      {/each}

      {#if overflow.length > 0}
        {@const overflowPending = overflow.some((entry) => (badges[entry.href] ?? 0) > 0)}
        <span class="w-px h-4 bg-surface-700 mx-0.5" aria-hidden="true"></span>
        <div class="relative">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-haspopup="true"
            onclick={() => (moreOpen = !moreOpen)}
            class="nav-btn nav-btn-muted cursor-pointer relative"
          >
            More
            {#if overflowPending}
              <span class="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-warning-500" aria-hidden="true"></span>
            {/if}
          </button>

          {#if moreOpen}
            <!-- Closes on a tap anywhere else, same as the report's jump list. -->
            <button
              type="button"
              aria-label="Close the More menu"
              class="fixed inset-0 z-10 cursor-default"
              onclick={() => (moreOpen = false)}
            ></button>
            <ul class="absolute right-0 z-20 mt-1 w-56 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-2xl">
              {#each overflow as entry (entry.href)}
                {@const badge = badges[entry.href] ?? 0}
                {@const unavailable = isOffline && needsConnection(entry)}
                <li>
                  <a
                    href={entry.href}
                    aria-current={isCurrentEntry(entry) ? "page" : undefined}
                    data-sveltekit-preload-data={unavailable ? "off" : undefined}
                    onclick={() => (moreOpen = false)}
                    class="flex items-center gap-2 px-3 py-2 text-xs no-underline transition-colors
                      {isCurrentEntry(entry) ? 'text-primary-300 bg-surface-800' : 'text-surface-200 hover:bg-surface-800'}"
                  >
                    <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d={entry.icon} />
                    </svg>
                    <span class="flex-1">{entry.label}</span>
                    {#if unavailable}
                      <span class="text-[10px] text-surface-500">Offline</span>
                    {:else if badge > 0}
                      <span class="tabular-nums text-warning-400">{badge}</span>
                    {/if}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </nav>

  </div>
</header>
