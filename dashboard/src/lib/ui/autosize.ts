import type { Action } from "svelte/action";

export interface AutosizeOptions {
  /** Cap in px: past it the textarea scrolls instead of growing. */
  max?: number;
  /** Focus on mount, caret at the end. */
  focus?: boolean;
  /** Pass the bound value so a programmatic change (not only typing) refits. */
  value?: string;
}

/** Grow a textarea with its content. */
export const autosize: Action<HTMLTextAreaElement, AutosizeOptions | undefined> = (node, initial) => {
  let options = initial ?? {};
  const fit = () => {
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, options.max ?? Infinity)}px`;
  };
  fit();
  if (options.focus) {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }
  node.addEventListener("input", fit);
  return {
    update(next) {
      options = next ?? {};
      fit();
    },
    destroy: () => node.removeEventListener("input", fit),
  };
};
