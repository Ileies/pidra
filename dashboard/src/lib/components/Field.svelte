<script lang="ts">
  /** A label wrapping one input, textarea or select, with an optional hint under the control. */
  import type { Snippet } from "svelte";

  interface Props {
    name?: string;
    label: string;
    hint?: string;
    /** Monospace control, for hosts, addresses and patterns. */
    mono?: boolean;
    /** The small, muted label used inside cards; the default is the roomier one used in sheets. */
    dense?: boolean;
    as?: "input" | "textarea" | "select";
    type?: string;
    value?: string | number | null;
    /** Classes on the label, for layout inside a row or grid. */
    class?: string;
    /** Classes on the control itself. */
    inputClass?: string;
    /** The `<option>`s of a select. */
    children?: Snippet;
    [attribute: string]: unknown;
  }

  let {
    name,
    label,
    hint,
    mono = false,
    dense = false,
    as = "input",
    type = "text",
    value = $bindable(),
    class: extra = "",
    inputClass = "",
    children,
    ...rest
  }: Props = $props();

  const labelClass = $derived(
    `flex flex-col ${dense ? "gap-1 text-xs text-surface-400" : "gap-1.5 text-sm text-surface-300"} ${extra}`,
  );
  const controlClass = $derived(
    `input-base-flush w-full ${mono ? "font-mono" : ""} ${as === "textarea" ? "resize-y" : ""} ${inputClass}`,
  );
  const update = (event: Event) => {
    value = (event.currentTarget as HTMLInputElement).value;
  };
</script>

<label class={labelClass}>
  {label}
  {#if as === "textarea"}
    <textarea {name} {value} oninput={update} class={controlClass} {...rest}></textarea>
  {:else if as === "select"}
    <select {name} {value} onchange={update} class={controlClass} {...rest}>{@render children?.()}</select>
  {:else}
    <input {name} {type} {value} oninput={update} class={controlClass} {...rest} />
  {/if}
  {#if hint}<span class="text-xs text-surface-500">{hint}</span>{/if}
</label>
