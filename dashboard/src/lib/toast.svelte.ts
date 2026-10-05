/**
 * The one toast store (`toasts`), rendered by `Toast.svelte` in the root layout. This is where a
 * transient message goes; inline text stays for field-level validation, next to its field.
 * Durations: 6s default, 9s with an undo, `error()` never auto-dismisses.
 */

import { errMessage } from "$pipeline/util/text";
import { untrack } from "svelte";

type ToastTone = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  /** Duration of the countdown, or null when the toast stays until dismissed. */
  durationMs: number | null;
  /** Present when the action is reversible. Runs once, then the toast closes. */
  undo?: () => Promise<void> | void;
}

const DEFAULT_MS = 6000;
/** An undoable toast lives longer: the offer is the point, and 6s is not enough to notice it. */
const UNDO_MS = 9000;

class ToastStore {
  items = $state<ToastItem[]>([]);
  #next = 1;
  #timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, options: { tone?: ToastTone; undo?: ToastItem["undo"]; ms?: number } = {}): number {
    const id = this.#next++;
    const ms = options.ms ?? (options.undo ? UNDO_MS : DEFAULT_MS);
    const durationMs = Number.isFinite(ms) ? Math.max(0, ms) : null;
    const item: ToastItem = { id, message, tone: options.tone ?? "info", undo: options.undo, durationMs };
    this.items = [...this.items, item];

    // A non-finite delay means "stays until dismissed". Passing one to setTimeout would not do
    // that - anything past 2^31-1 ms wraps to 1 and fires on the next tick.
    if (durationMs !== null) {
      this.#timers.set(
        id,
        setTimeout(() => this.dismiss(id), durationMs),
      );
    }
    return id;
  }

  success(message: string, undo?: ToastItem["undo"]) {
    return this.show(message, { tone: "success", undo });
  }

  /** Errors do not auto-dismiss: a message the user did not see is a message that did not happen. */
  error(message: string) {
    return this.show(message, { tone: "error", ms: Number.POSITIVE_INFINITY });
  }

  dismiss(id: number) {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    this.items = this.items.filter((item) => item.id !== id);
  }

  async runUndo(id: number) {
    const item = this.items.find((entry) => entry.id === id);
    this.dismiss(id);
    if (!item?.undo) return;
    try {
      await item.undo();
    } catch (err) {
      this.error(errMessage(err));
    }
  }
}

export const toasts = new ToastStore();

/**
 * Show a form action's result (`error` or `message`) as a toast.
 *
 * Call inside an `$effect`; it fires once per result object, because `form` only changes
 * identity when an action returns.
 */
export function toastFormResult(
  form: { error?: string; message?: string; success?: boolean } | null | undefined,
): void {
  if (!form) return;
  const { error, message } = form;
  // `show()` reads `items` before writing it; untracked, the calling effect depends on `form` only.
  untrack(() => {
    if (error) toasts.error(error);
    else if (message) toasts.success(message);
  });
}
