<script lang="ts">
  /**
   * The one navbar. Mounted once by the root layout and never torn down, so clicking a link
   * swaps only the page below it. Anything route-dependent derives from `page`, never from a
   * prop: a prop would let each page decide what the header looks like, which is the problem
   * this component exists to remove.
   *
   * Two forms (M-1):
   *
   * - **`sm` and up:** one horizontal row, grouped rather than flat. Ten to twelve controls in
   *   a single ungrouped row was the cause of the mobile header, and it was not much of a
   *   desktop layout either.
   * - **Below `sm`:** the app icon, the page title, and one overflow button - roughly 52px,
   *   against the 150-200px the wrapped row used to take. Everything else lives in the bottom
   *   tab bar and its More sheet.
   *
   * The day steppers are gone from here. They were only ever on one route, they were the two
   * controls that pushed the row over, and they belong next to the date they step.
   */
  import { page } from "$app/state";
  import { ROUTES, NAV_GROUPS, needsConnection, routeFor, type NavGroup, type RouteDef } from "#lib/routes.js";
  import NotifyButton from "#lib/components/NotifyButton.svelte";
  import SyncIndicator from "#lib/offline/SyncIndicator.svelte";
  import { offline } from "#lib/offline/state.svelte.js";
  import { navBadges } from "#lib/navBadges.svelte.js";

  interface Props {
    /** Opens the More sheet, which the mobile overflow button shares with the tab bar. */
    onOpenMore: () => void;
  }

  let { onOpenMore }: Props = $props();

  const routeId = $derived(page.route.id ?? "");
  const current = $derived(routeFor(routeId));
  /** Keyed by href, so the navbar renders a badge without knowing what it counts. */
  const badges = $derived(navBadges.counts);
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
  const byGroup = $derived(
    GROUPS.map((group) => ROUTES.filter((route) => route.group === group)).filter((list) => list.length > 0),
  );

  function isCurrentEntry(entry: RouteDef): boolean {
    return current?.href === entry.href;
  }
</script>

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

    <!-- Desktop: the whole registry, grouped. -->
    <nav aria-label="Main" class="hidden sm:flex items-center justify-end gap-2 flex-wrap ml-auto">
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
                  : entry.secondary
                    ? 'nav-btn-muted'
                    : 'nav-btn-idle'}"
          >
            {entry.label}{#if badge > 0}<span class="ml-1 tabular-nums">({badge})</span><span class="sr-only"> waiting for you</span>{/if}{#if unavailable}<span class="sr-only"> (needs the connection)</span>{/if}
          </a>
        {/each}
      {/each}
      <span class="w-px h-4 bg-surface-700 mx-0.5" aria-hidden="true"></span>
      <NotifyButton />
    </nav>

    <!-- Mobile: one control. Everything else is in the tab bar. -->
    <button
      type="button"
      onclick={onOpenMore}
      aria-label="Open menu"
      class="tap sm:hidden ml-auto flex items-center justify-center rounded-lg border border-surface-700 bg-surface-950 px-3 text-surface-200 cursor-pointer relative"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
      {#if Object.values(badges).some((count) => count > 0)}
        <span class="absolute top-1 right-1 h-2 w-2 rounded-full bg-warning-500" aria-hidden="true"></span>
      {/if}
    </button>
  </div>
</header>
