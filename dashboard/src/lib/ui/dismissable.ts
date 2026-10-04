import type { Action } from "svelte/action";

export interface DismissOptions {
  /** Listeners exist only while this is true, so a closed dropdown costs nothing. */
  open: boolean;
  onclose: () => void;
  /**
   * `swallow` (default): an outside click only closes, it never reaches what is underneath, like the
   * full-screen scrim button this replaces. `pass`: the press closes and then goes on to its target.
   */
  outside?: "swallow" | "pass";
  /** Presses on elements matching this selector never count as outside (a trigger that lives elsewhere). */
  ignore?: string;
}

/** Close on Escape and on a press outside the node. The trigger belongs inside the node. */
export const dismissable: Action<HTMLElement, DismissOptions> = (node, initial) => {
  let options = initial;
  let detach: (() => void) | undefined;

  const outside = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    !node.contains(target) &&
    !(options.ignore && target instanceof Element && target.closest(options.ignore));

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") options.onclose();
  };
  const onPress = (event: Event) => {
    if (!outside(event.target)) return;
    options.onclose();
  };
  const onClickCapture = (event: Event) => {
    if (!outside(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    options.onclose();
  };

  function sync() {
    detach?.();
    detach = undefined;
    if (!options.open) return;
    const swallow = (options.outside ?? "swallow") === "swallow";
    const type = swallow ? "click" : "pointerdown";
    const handler = swallow ? onClickCapture : onPress;
    document.addEventListener("keydown", onKeydown);
    document.addEventListener(type, handler, swallow);
    detach = () => {
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener(type, handler, swallow);
    };
  }

  sync();
  return {
    update(next) {
      options = next;
      sync();
    },
    destroy() {
      detach?.();
    },
  };
};
