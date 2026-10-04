<script lang="ts">
  /**
   * The sync sheet: what the header logo opens. Non-modal, so the page behind it stays live.
   * Mounted once in the root layout next to the other global overlays (`Assistant`, `Toast`,
   * `CommandPalette`) rather than inside `Navbar`, so it is a fixed overlay rather than something
   * fighting the header's own layout.
   */
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import X from "@lucide/svelte/icons/x";
  import { offline } from "#lib/offline/state.svelte.js";
  import { fmtDateTime, fmtElapsed } from "#lib/format.js";
  import { toasts } from "#lib/toast.svelte.js";
  import { INTENT_LABEL, intentSummary } from "#lib/offline/outbox.js";
  import FailedWrite from "#lib/offline/FailedWrite.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import { dismissable } from "#lib/ui/dismissable.js";
  import { swipeToClose } from "#lib/ui/swipeToClose.js";

  let confirmingClear = $state(false);

  // A confirm left half-answered should not greet the next opening.
  $effect(() => {
    if (!offline.sheetOpen) confirmingClear = false;
  });

  async function clearMirror() {
    confirmingClear = false;
    const result = await offline.clearMirror();
    if (result.ok) toasts.success("Offline data cleared.");
    else toasts.error(result.reason ?? "Could not clear offline data.");
  }

  /** The headline, in the same order of precedence as the logo's colour. */
  const status = $derived(
    offline.isOffline
      ? { word: "Offline", dot: "bg-error-500" }
      : offline.failed.length > 0
        ? { word: "Needs attention", dot: "bg-error-500" }
        : offline.syncing
          ? { word: "Syncing", dot: "bg-success-500 animate-pulse" }
          : offline.queuedCount > 0
            ? { word: "Changes queued", dot: "bg-warning-500" }
            : offline.reachable === "checking"
              ? { word: "Checking", dot: "bg-surface-500 animate-pulse" }
              : { word: "Synced", dot: "bg-success-500" },
  );
</script>

{#if offline.sheetOpen}
  <!-- Not modal: nothing dims or blocks the page behind it. A press anywhere else dismisses it, except
       on the logo that toggles it, which would otherwise close here and reopen on its own click. -->
  <div
    use:dismissable={{ open: true, onclose: () => offline.closeSheet(), outside: "pass", ignore: "[data-sync-trigger]" }}
    use:swipeToClose={() => offline.closeSheet()}
    role="dialog"
    aria-label="Sync status"
    aria-modal="false"
    class="sheet fixed inset-x-0 bottom-0 z-50 lg:inset-x-auto lg:left-8 lg:top-16 lg:bottom-auto lg:w-96
           max-h-[80dvh] lg:max-h-[calc(100dvh-6rem)] overflow-y-auto
           rounded-t-2xl lg:rounded-2xl border-t lg:border border-surface-700 bg-surface-900
           px-4 pt-3 pb-[calc(1rem+var(--safe-b))] lg:pt-4 lg:pb-4 flex flex-col gap-4 shadow-2xl"
  >
    <div class="mx-auto lg:hidden -mb-1 h-1 w-10 rounded-full bg-surface-600" aria-hidden="true"></div>

    <div class="flex items-start justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <h2 class="text-[11px] font-medium uppercase tracking-wider text-surface-400">Sync status</h2>
        <p class="flex items-center gap-2 text-lg font-semibold text-surface-50">
          <span class="h-2.5 w-2.5 rounded-full {status.dot}" aria-hidden="true"></span>
          {status.word}
        </p>
      </div>
      <button
        type="button"
        onclick={() => offline.closeSheet()}
        aria-label="Close"
        class="tap -mr-1.5 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>

    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-surface-800 bg-surface-950 p-3 text-xs">
      <div class="flex flex-col gap-0.5">
        <dt class="text-surface-400">Connection</dt>
        <dd class="text-surface-100">{offline.reachable === "online" ? "Reachable" : offline.isOffline ? "Not reachable" : "Checking…"}</dd>
      </div>
      <div class="flex flex-col gap-0.5">
        <dt class="text-surface-400">Last synced</dt>
        <dd class="text-surface-100" title={offline.lastSyncedAt ? fmtDateTime(offline.lastSyncedAt) : undefined}>
          {offline.lastSyncedAt ? `${fmtElapsed(offline.lastSyncedAt)} ago` : "Never"}
        </dd>
      </div>
      <div class="flex flex-col gap-0.5">
        <dt class="text-surface-400">Reports mirrored</dt>
        <dd class="text-surface-100 tabular-nums">{offline.mirroredReportCount}</dd>
      </div>
      <div class="flex flex-col gap-0.5">
        <dt class="text-surface-400">Oldest report</dt>
        <dd class="text-surface-100 tabular-nums">{offline.oldestMirroredDate ?? "-"}</dd>
      </div>
    </dl>

    {#if offline.pending.length > 0}
      <section class="flex flex-col gap-2 rounded-lg border border-warning-800 bg-warning-950/30 p-3">
        <h3 class="text-xs font-medium text-warning-400">{offline.pending.length} queued</h3>
        <ul class="flex flex-col divide-y divide-surface-800">
          {#each offline.pending as intent (intent.id)}
            <li class="flex items-center gap-2 py-1.5 text-xs text-surface-300 first:pt-0 last:pb-0">
              <Badge tone="warning" class="shrink-0">{INTENT_LABEL[intent.kind]}</Badge>
              <span class="min-w-0 truncate">{intentSummary(intent)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if offline.failed.length > 0}
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-error-400">{offline.failed.length} failed</h3>
        <ul class="flex flex-col gap-2">
          {#each offline.failed as intent (intent.id)}
            <li><FailedWrite {intent} showTarget /></li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if confirmingClear}
      <div role="alertdialog" aria-label="Clear offline data" class="flex flex-col gap-3 rounded-lg border border-error-800 bg-error-950/30 p-3">
        <p class="text-xs text-surface-200">
          Remove the offline copy from this device? Reports and pages will be downloaded again on the next sync.
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            onclick={() => (confirmingClear = false)}
            class="btn btn-sm btn-ghost"
          >Cancel</button>
          <button
            type="button"
            onclick={clearMirror}
            class="tap rounded-lg border border-error-700 bg-error-900 px-3 py-1.5 text-xs font-medium text-error-100 transition-colors hover:bg-error-800"
          >Clear</button>
        </div>
      </div>
    {:else}
    <div class="flex items-center justify-between gap-3">
      <button
        type="button"
        onclick={() => offline.syncNow()}
        disabled={offline.syncing}
        class="btn btn-sm btn-primary font-medium"
      >
        <RefreshCw class="size-3.5 {offline.syncing ? 'animate-spin' : ''}" aria-hidden="true" />
        {offline.syncing ? "Syncing…" : "Sync now"}
      </button>
      <button
        type="button"
        onclick={() => (confirmingClear = true)}
        disabled={offline.pending.length > 0}
        title={offline.pending.length > 0 ? "Sync first - writes are still queued" : ""}
        class="tap rounded px-1 py-1 text-xs text-surface-400 transition-colors hover:text-error-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-surface-400"
      >Clear offline data</button>
    </div>
    {/if}
  </div>
{/if}

<style>
  .sheet {
    animation: sheet-in 0.18s ease-out;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (min-width: 1024px) {
    @keyframes sheet-in {
      from {
        opacity: 0;
        transform: translateY(-6px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
  }
</style>
