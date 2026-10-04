import { SvelteSet } from "svelte/reactivity";
import { toasts } from "#lib/toast.svelte.js";
import { errMessage } from "$pipeline/util/text";

/**
 * Selection is a mode, not a checkbox on every card. `selecting` is the explicit mode (the
 * toolbar's Select); a hover checkbox on desktop starts one implicitly, and while anything is
 * selected a tap on a card toggles it rather than opening the editor. Call during component init.
 */
export function useNoteSelection(visibleIds: () => string[]) {
  let selecting = $state(false);
  let busy = $state(false);
  const selected = new SvelteSet<string>();

  const selectionActive = $derived(selecting || selected.size > 0);
  const allSelected = $derived(visibleIds().length > 0 && visibleIds().every((id) => selected.has(id)));

  // A filter change can hide selected rows; acting on invisible selection is a nasty surprise.
  $effect(() => {
    const visible = new Set(visibleIds());
    for (const id of [...selected]) if (!visible.has(id)) selected.delete(id);
  });

  function toggle(id: string, on: boolean) {
    if (on) selected.add(id);
    else selected.delete(id);
  }

  function toggleAll() {
    const selectAll = !allSelected;
    selected.clear();
    if (selectAll) for (const id of visibleIds()) selected.add(id);
  }

  function end() {
    selecting = false;
    selected.clear();
  }

  /** Applies `apply` to every selected note, one after another, and says what happened. */
  async function runBulk(
    apply: (id: string) => Promise<unknown>,
    outcome: string,
    undo?: (id: string) => Promise<unknown>,
  ) {
    if (busy) return;
    busy = true;
    const ids = [...selected];
    try {
      for (const id of ids) await apply(id);
      selected.clear();
      const message = `${ids.length} ${ids.length === 1 ? "note" : "notes"} ${outcome}.`;
      if (undo) {
        toasts.success(message, async () => {
          for (const id of ids) await undo(id);
        });
      } else toasts.success(message);
    } catch (err) {
      toasts.error(errMessage(err));
    } finally {
      busy = false;
    }
  }

  return {
    get selecting() {
      return selecting;
    },
    set selecting(on: boolean) {
      selecting = on;
    },
    get busy() {
      return busy;
    },
    get count() {
      return selected.size;
    },
    get active() {
      return selectionActive;
    },
    get all() {
      return allSelected;
    },
    has: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    end,
    runBulk,
  };
}

export type NoteSelection = ReturnType<typeof useNoteSelection>;
