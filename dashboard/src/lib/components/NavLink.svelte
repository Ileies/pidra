<script lang="ts">
  /**
   * One registry entry as a link, in the three shapes the app shows it in: a header icon, a tile in
   * the desktop More menu and the mobile More sheet, and a bottom-bar tab. The badge, the
   * offline "needs the connection" state and the preload switch are the same in all three.
   * Offline, a page that needs the connection stays tappable (it opens OfflineNotice in the same
   * frame) but says so, and no longer preloads on hover or touch.
   */
  import { needsConnection } from "#lib/offline/onlineOnly.js";
  import type { RouteDef } from "#lib/routes.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { navBadges } from "#lib/navBadges.svelte.js";
  import CountBadge from "#lib/components/CountBadge.svelte";

  interface Props {
    entry: RouteDef;
    current: boolean;
    variant: "icon" | "tile" | "tab";
    onclick?: () => void;
  }

  let { entry, current, variant, onclick }: Props = $props();

  const badge = $derived(navBadges.counts[entry.href] ?? 0);
  const unavailable = $derived(offline.isOffline && needsConnection(entry));

  const LOOK = {
    icon: {
      base: "tap relative flex h-10 w-10 items-center justify-center rounded-lg border no-underline transition-colors",
      current: "border-primary-800 bg-primary-950 text-primary-300",
      unavailable: "border-dashed border-surface-700 bg-surface-950 text-surface-500 hover:text-surface-300",
      idle: "border-surface-700 bg-surface-950 text-surface-300 hover:border-surface-500 hover:text-surface-100",
      svg: "h-5 w-5",
      stroke: 1.7,
    },
    tile: {
      base: "relative flex flex-col items-center gap-2 rounded-xl px-2 py-4 text-center text-xs no-underline transition-colors",
      current: "text-primary-300 bg-surface-800",
      unavailable: "text-surface-500 hover:bg-surface-800",
      idle: "text-surface-200 hover:bg-surface-800",
      svg: "h-10 w-10 shrink-0",
      stroke: 1.4,
    },
    tab: {
      base: "relative flex h-14 flex-col items-center justify-center gap-0.5 no-underline text-xs transition-colors",
      current: "text-primary-300",
      unavailable: "text-surface-400",
      idle: "text-surface-400",
      svg: "h-5 w-5",
      stroke: 1.6,
    },
  } as const;

  const look = $derived(LOOK[variant]);
  // The tab dims whether or not it is the current one, so it is the only shape where the two can combine.
  const tone = $derived(
    variant === "tab"
      ? `${current ? look.current : look.idle}${unavailable ? " opacity-70" : ""}`
      : current
        ? look.current
        : unavailable
          ? look.unavailable
          : look.idle,
  );
  const spoken = $derived(`${entry.label}${unavailable ? " (needs the connection)" : ""}${badge > 0 ? `, ${badge} waiting for you` : ""}`);
</script>

<a
  href={entry.href}
  aria-current={current ? "page" : undefined}
  data-sveltekit-preload-data={unavailable ? "off" : undefined}
  title={variant === "icon" ? (unavailable ? `${entry.label} (needs the connection)` : entry.label) : variant === "tile" && unavailable ? "Needs the connection" : undefined}
  aria-label={variant === "icon" ? spoken : variant === "tab" ? (unavailable ? `${entry.label} (needs the connection)` : badge > 0 ? `${entry.label}, ${badge} waiting for you` : undefined) : undefined}
  {onclick}
  class="{look.base} {tone}"
>
  <svg viewBox="0 0 24 24" class={look.svg} fill="none" stroke="currentColor" stroke-width={look.stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={entry.icon} />
  </svg>
  {#if variant === "icon"}
    <CountBadge count={badge} class="absolute -right-2 -top-2 border-2 border-surface-900" />
  {:else if variant === "tile"}
    <span class="w-full truncate">{entry.label}</span>
    {#if unavailable}
      <span class="sr-only">(needs the connection)</span>
    {:else if badge > 0}
      <CountBadge count={badge} class="absolute right-2 top-2" />
      <span class="sr-only">{badge} waiting for you</span>
    {/if}
  {:else if variant === "tab"}
    {entry.label}
    <CountBadge count={badge} class="absolute top-1 left-1/2 ml-1" />
  {/if}
</a>
