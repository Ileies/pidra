/**
 * The one toast store (E3).
 *
 * /notes had the only real toast in the app, with the only undo, and four other pages rendered
 * their own inline `form?.error` / `form?.success` block instead. This is where a transient
 * message goes now; inline text stays for field-level validation, where the message has to sit
 * next to the field it is about.
 */

export type ToastTone = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
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
    const item: ToastItem = { id, message, tone: options.tone ?? "info", undo: options.undo };
    this.items = [...this.items, item];

    // A non-finite delay means "stays until dismissed". Passing one to setTimeout would not do
    // that - anything past 2^31-1 ms wraps to 1 and fires on the next tick.
    const ms = options.ms ?? (item.undo ? UNDO_MS : DEFAULT_MS);
    if (Number.isFinite(ms)) {
      this.#timers.set(
        id,
        setTimeout(() => this.dismiss(id), ms),
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
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}

export const toasts = new ToastStore();
