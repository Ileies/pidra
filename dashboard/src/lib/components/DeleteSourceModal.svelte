<script lang="ts">
  /**
   * The hard-delete confirmation for a source. Modeled on the dashboard's one overlay pattern
   * (`SyncSheet.svelte`: scrim + dialog, Esc to close) but centered rather than a sheet, since
   * this is a small confirm rather than a content panel (see `Shortcuts.svelte`).
   *
   * Unlike `ConfirmButton`, this offers a third choice when the source is known to have an
   * unsubscribe link: open it (in a new tab, for the reader to finish - the server never visits
   * it itself) and delete, rather than just delete.
   */
  import { enhance } from "$app/forms";
  import { toasts } from "#lib/toast.svelte.js";

  interface Props {
    sourceName: string;
    unsubscribeUrl: string | null;
    /** Form action, e.g. "?/delete". */
    action: string;
    onDeleted?: () => void;
  }

  let { sourceName, unsubscribeUrl, action, onDeleted }: Props = $props();

  let open = $state(false);

  function close() {
    open = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) close();
  }

  function openUnsubscribeTab() {
    if (unsubscribeUrl) window.open(unsubscribeUrl, "_blank", "noopener,noreferrer");
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button
  type="button"
  onclick={() => (open = true)}
  class="tap px-3 py-1.5 rounded text-xs border bg-transparent cursor-pointer transition-colors border-surface-500 text-surface-300 hover:border-error-500 hover:text-error-400"
>
  Delete
</button>

{#if open}
  <button type="button" aria-label="Close" class="fixed inset-0 z-40 bg-surface-950/70" onclick={close}></button>

  <div
    role="dialog"
    aria-modal="true"
    aria-label="Delete source"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
  >
    <div class="relative w-full max-w-sm rounded-lg border border-surface-600 bg-surface-900 p-5 shadow-2xl flex flex-col gap-4">
      <h2 class="text-sm font-semibold text-surface-100">Delete "{sourceName}"?</h2>
      <p class="text-xs text-surface-400 leading-relaxed">
        This removes it from the sources list for good and stops it from being polled or matched.
        Past deliveries and scores stay on record. This cannot be undone.
      </p>

      <form
        method="POST"
        {action}
        use:enhance={() => async ({ update, result }) => {
          close();
          if (result.type === "success" && onDeleted) {
            // The page being left no longer has a source to load, so skip the invalidate.
            toasts.success(`Deleted ${sourceName}.`);
            onDeleted();
          } else if (result.type === "error") {
            toasts.error(result.error instanceof Error ? result.error.message : "Could not delete the source.");
          } else {
            await update();
          }
        }}
        class="flex flex-col gap-2"
      >
        <input type="hidden" name="sourceName" value={sourceName} />

        {#if unsubscribeUrl}
          <button
            type="submit"
            onclick={openUnsubscribeTab}
            class="tap px-3 py-1.5 rounded text-xs border cursor-pointer transition-colors bg-error-800 border-error-600 text-error-100 hover:bg-error-700"
          >
            Yes, also open unsubscribe link
          </button>
        {/if}
        <button
          type="submit"
          class="tap px-3 py-1.5 rounded text-xs border cursor-pointer transition-colors {unsubscribeUrl
            ? 'border-error-600 text-error-300 bg-transparent hover:bg-error-950'
            : 'bg-error-800 border-error-600 text-error-100 hover:bg-error-700'}"
        >
          Yes, delete
        </button>
        <button
          type="button"
          onclick={close}
          class="tap px-3 py-1.5 rounded text-xs border border-surface-500 text-surface-300 bg-transparent hover:text-surface-100 cursor-pointer transition-colors"
        >
          No, cancel
        </button>
      </form>
    </div>
  </div>
{/if}
