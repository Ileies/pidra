<script lang="ts">
  /**
   * A modal panel on the native `<dialog>`: a bottom sheet on a phone, a centred card from `sm`.
   * The browser supplies the focus trap, Esc and the inert background; this supplies the look.
   */
  import type { Snippet } from "svelte";
  import X from "@lucide/svelte/icons/x";
  import { swipeToClose } from "#lib/ui/swipeToClose.js";

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
  }

  let { open, title, onclose, children }: Props = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  use:swipeToClose={onclose}
  aria-label={title}
  {onclose}
  onclick={(event) => {
    if (event.target === dialog) onclose();
  }}
  class="m-auto w-[min(40rem,calc(100%-2rem))] overflow-hidden rounded-lg border border-surface-600 bg-surface-900 p-0 text-surface-200 shadow-2xl backdrop:bg-surface-950/70 max-sm:mb-0 max-sm:mt-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
>
  <div class="flex max-h-[85dvh] flex-col">
    <div class="flex items-center gap-3 border-b border-surface-700 px-4 py-2 sm:px-5">
      <h2 class="flex-1 text-sm font-semibold text-surface-50">{title}</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label="Close"
        class="tap inline-flex items-center justify-center rounded bg-transparent px-2 text-surface-400 hover:text-surface-100 cursor-pointer border-none"
      ><X class="h-4 w-4" aria-hidden="true" /></button>
    </div>
    <div class="overflow-y-auto px-4 py-4 pb-[calc(1rem+var(--safe-b))] sm:px-5">
      {@render children()}
    </div>
  </div>
</dialog>
