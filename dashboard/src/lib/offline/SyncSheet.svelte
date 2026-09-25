<script lang="ts">
  /**
   * The sync sheet: what the header dot opens. Mounted once in the root
   * layout next to the other global overlays (`Assistant`, `Toast`, `CommandPalette`) rather than
   * inside `Navbar`, so it is a fixed overlay rather than something fighting the header's own
   * layout.
   */
  import { offline } from "#lib/offline/state.svelte.js";
  import { fmtDateTime, fmtElapsed } from "#lib/format.js";
  import { toasts } from "#lib/toast.svelte.js";
  import { INTENT_LABEL, intentSummary } from "#lib/offline/outbox.js";
  import FailedWrite from "#lib/offline/FailedWrite.svelte";

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && offline.sheetOpen) offline.closeSheet();
  }

  async function clearMirror() {
    const result = await offline.clearMirror();
    if (result.ok) toasts.success("Offline data cleared.");
    else toasts.error(result.reason ?? "Could not clear offline data.");
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if offline.sheetOpen}
  <button
    type="button"
    aria-label="Close sync status"
    class="fixed inset-0 z-40 bg-surface-950/70"
    onclick={() => offline.closeSheet()}
  ></button>

  <div
    role="dialog"
    aria-label="Sync status"
    aria-modal="true"
    class="fixed inset-x-0 bottom-0 z-50 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 max-h-[80dvh] overflow-y-auto
           rounded-t-2xl sm:rounded-2xl border-t sm:border border-surface-700 bg-surface-900
           px-4 pt-3 pb-[calc(1rem+var(--safe-b))] sm:pb-4 flex flex-col gap-3 shadow-2xl"
  >
    <div class="mx-auto sm:hidden mb-1 h-1 w-10 rounded-full bg-surface-600" aria-hidden="true"></div>

    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-surface-100">Sync status</h2>
      <button
        type="button"
        onclick={() => offline.closeSheet()}
        aria-label="Close"
        class="tap text-surface-400 hover:text-surface-200 cursor-pointer bg-transparent border-none px-1"
      >✕</button>
    </div>

    <div class="text-xs text-surface-400 flex flex-col gap-1">
      <p>
        {offline.reachable === "online" ? "Reachable." : offline.reachable === "offline" ? "Not reachable." : "Checking…"}
        {#if offline.lastSyncedAt}
          Last synced {fmtElapsed(offline.lastSyncedAt)} ago ({fmtDateTime(offline.lastSyncedAt)}).
        {:else}
          Never synced yet.
        {/if}
      </p>
      <p>
        {offline.mirroredReportCount} {offline.mirroredReportCount === 1 ? "report" : "reports"} mirrored
        {#if offline.oldestMirroredDate}, oldest {offline.oldestMirroredDate}{/if}.
      </p>
    </div>

    {#if offline.pending.length > 0}
      <div class="flex flex-col gap-1.5">
        <p class="text-xs font-medium text-surface-300">{offline.pending.length} queued</p>
        <ul class="flex flex-col gap-1">
          {#each offline.pending as intent (intent.id)}
            <li class="rounded border border-surface-700 bg-surface-950 px-2.5 py-1.5 text-xs text-surface-300 flex items-center gap-2">
              <span class="badge border border-warning-800 bg-warning-950 text-warning-400 shrink-0">{INTENT_LABEL[intent.kind]}</span>
              <span class="truncate min-w-0">{intentSummary(intent)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if offline.failed.length > 0}
      <div class="flex flex-col gap-1.5">
        <p class="text-xs font-medium text-error-400">{offline.failed.length} failed</p>
        <ul class="flex flex-col gap-1">
          {#each offline.failed as intent (intent.id)}
            <li><FailedWrite {intent} showTarget /></li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="flex flex-wrap gap-2 mt-1">
      <button
        type="button"
        onclick={() => offline.syncNow()}
        disabled={offline.syncing}
        class="tap px-3 py-1.5 rounded text-xs bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer disabled:opacity-40"
      >{offline.syncing ? "Syncing…" : "Sync now"}</button>
      <button
        type="button"
        onclick={clearMirror}
        disabled={offline.pending.length > 0}
        title={offline.pending.length > 0 ? "Sync first - writes are still queued" : ""}
        class="tap px-3 py-1.5 rounded text-xs bg-surface-800 border border-surface-500 text-surface-200 hover:bg-surface-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >Clear offline data</button>
    </div>
  </div>
{/if}
