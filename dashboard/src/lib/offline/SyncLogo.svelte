<script lang="ts">
  /**
   * The app logo as the header's sync control: its two halves are coloured by sync state, and a tap
   * opens `SyncSheet` (a sheet, not a route, so `routes.ts` needs no entry). States:
   *
   * - **Synced:** the brand greens.
   * - **Syncing:** a brighter green whose light half breathes while a pull is in flight.
   * - **Checking:** muted, pulsing as a whole.
   * - **Queued writes:** amber.
   * - **Failed writes, or offline:** red. Every state also reads out through the button's title and
   *   screen-reader label, so colour is never the only message.
   *
   * The path data is the same as `static/icons/icon.svg`, minus its blur filter (0.6 user units of a
   * 780 unit canvas, invisible at header size). A change to the mark means changing both.
   */
  import { offline } from "#lib/offline/state.svelte.js";


  // Every part that applies, so a count never hides that the app is offline, or the other way round.
  const label = $derived(
    [
      offline.syncing ? "Syncing" : offline.isOffline ? "Offline" : offline.reachable === "checking" ? "Checking" : null,
      offline.failed.length > 0 ? `${offline.failed.length} not saved` : null,
      offline.pending.length > 0 ? `${offline.pending.length} queued` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Synced",
  );

  type Tone = { light: string; dark: string; line: string };

  const TONES = {
    ok: { light: "#789d68", dark: "#114430", line: "#dce8d7" },
    syncing: { light: "#a3cb90", dark: "#1a5a40", line: "#eef6ea" },
    checking: { light: "var(--color-surface-400)", dark: "var(--color-surface-800)", line: "var(--color-surface-300)" },
    queued: { light: "var(--color-warning-500)", dark: "#4a3408", line: "#f6dfa6" },
    error: { light: "var(--color-error-500)", dark: "var(--color-error-950)", line: "#f4c4c4" },
  } as const satisfies Record<string, Tone>;

  const tone = $derived<Tone>(
    offline.isOffline || offline.failed.length > 0
      ? TONES.error
      : offline.syncing
        ? TONES.syncing
        : offline.pending.length > 0
          ? TONES.queued
          : offline.reachable === "checking"
            ? TONES.checking
            : TONES.ok,
  );
</script>

<button
  type="button"
  onclick={() => offline.toggleSheet()}
  aria-haspopup="dialog"
  data-sync-trigger
  aria-expanded={offline.sheetOpen}
  title={label}
  class="tap relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
>
  <span
    class="logo flex h-8 w-8 {offline.reachable === 'checking' && !offline.syncing ? 'animate-pulse' : ''}"
    class:syncing={offline.syncing}
    style="--logo-light: {tone.light}; --logo-dark: {tone.dark}; --logo-line: {tone.line};"
    aria-hidden="true"
  >
  <svg viewBox="0 0 780 780" class="h-8 w-8">
    <path
      class="dark"
      d="M361 4c-16 5-26 14-38 36l-25 44c-23 44-28 53-40 68-18 25-30 37-53 53q-25 18-34 36c-6 11-7 15-12 46-6 40-6 46 8 74 21 44 31 73 44 132 5 24 8 32 13 40q12 19 32 19c15 1 20-2 65-28 53-32 53-32 63-41 12-13 17-23 17-38l-3-16c-6-19-18-32-57-64l-33-27a96 96 0 0 1-27-42l-2-14q0-22 17-39 10-12 28-18c18-6 59-15 102-23 31-5 42-9 51-19 6-6 7-9 7-18 0-10-2-15-31-73-30-59-33-65-42-74a51 51 0 0 0-50-14M113 191l-23 21c-26 26-39 36-69 55q-17 9-17 26c0 8 2 13 11 28q26 38 39 81 3 3 12-4c25-20 47-51 54-78 7-21 13-68 13-89 0-15-1-22-5-31q-7-12-15-9m513 0q-5 4-11 16c-2 7-2 10-2 23 0 23 6 65 12 87 7 29 30 62 54 80q10 9 13 5l7-17q14-34 29-60c13-19 13-20 14-30l-2-13c-4-7-8-11-22-20-23-14-37-25-64-51-20-20-23-22-28-20m-59 146q-7 4-10 10c-9 14-25 55-30 80-2 9-2 13-2 23 1 11 1 14 7 34 9 31 10 37 11 60 0 17 0 19 2 22 7 10 17 10 53-1l50-14c43-11 44-11 54-16q14-8 20-20c3-6 3-7 3-14q0-9-2-15c-6-13-14-22-50-54q-36-28-62-66c-13-19-18-25-25-29q-10-6-19 0M450 490q-16 3-36 15l-103 61c-24 15-34 23-39 34-3 6-3 7-3 17 0 9 0 10 3 18l12 20c10 15 18 29 28 54 19 41 24 49 41 57 22 10 46 4 60-17 6-8 9-15 23-44 13-29 16-36 30-56q33-50 42-111-2-27-23-42c-9-5-24-8-35-6M90 579l6 13c15 27 23 50 28 86 4 26 8 35 19 41l7 4h15l37-2c25-2 42-1 67 4 17 2 19 3 19 0l-21-39q-30-52-66-70-55-21-111-37"
    />
    <path
      class="light"
      d="M258 67q-26 7-71 13c-36 5-42 7-52 15a42 42 0 0 0-11 48c4 8 30 33 38 37q24 12 50-21 33-44 59-92 2-3-13 0m216 0 1 3c1 4 35 52 51 73q25 34 52 33c11 0 16-3 30-16 15-15 17-19 17-34 0-11-1-12-4-18q-2-7-8-11c-10-9-18-12-51-17l-68-11c-17-4-19-5-20-2m46 147-25 6q-67 16-138 27-27 8-35 27-3 11 3 23 6 11 29 29c34 26 50 40 70 63s27 28 41 29c7 0 9 0 14-3q12-6 20-19l15-35 27-61c17-38 21-48 21-57 0-22-17-33-42-29M124 383c-6 3-8 5-26 22l-69 69q-18 29 2 50c8 8 19 13 53 23l50 15c25 7 33 9 41 7q12-2 14-13c3-12 1-25-20-98-14-52-18-63-25-71q-8-9-20-4m518 195c-16 4-82 27-91 31q-36 17-68 66c-10 15-25 44-25 47s1 3 19 0c29-5 46-6 89-2 20 1 27 1 34-2 13-6 18-15 22-45 6-36 14-60 31-88l5-10c-1-2-3-1-16 3"
    />
  </svg>
  </span>

  <span class="sr-only">{label}</span>
</button>

<style>
  .logo {
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--logo-light) 55%, transparent));
    transition: filter 0.2s ease-out;
  }

  button:hover .logo,
  button:focus-visible .logo {
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--logo-light) 90%, transparent));
  }

  .logo path {
    stroke: var(--logo-line);
    stroke-width: 5;
    stroke-linejoin: round;
    transition:
      fill 0.3s,
      stroke 0.3s;
  }

  .dark {
    fill: var(--logo-dark);
  }

  .light {
    fill: var(--logo-light);
  }

  .syncing .light {
    animation: breathe 1.1s ease-in-out infinite;
  }

  .syncing .dark {
    animation: breathe-dark 1.1s ease-in-out infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
  }

  @keyframes breathe-dark {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }
</style>
