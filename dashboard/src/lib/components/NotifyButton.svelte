<script lang="ts">
  /**
   * Web Push subscribe/unsubscribe control. The state and the toggle live in `$lib/push.svelte.ts`
   * (started from the root layout), so this renders the already-resolved answer instead of
   * re-checking on every mount.
   *
   * "checking" and "busy" render an inert control of the same width as the real one, so
   * resolving the subscription never resizes the row after paint.
   */
  import { push } from "#lib/push.svelte.js";
  import Switch from "#lib/components/Switch.svelte";

  interface Props {
    /** `bar` is the desktop nav pill; `row` is a bare switch whose label the caller renders. */
    variant?: "bar" | "row";
    /** Id of the element naming the `row` switch. */
    labelledby?: string;
  }

  let { variant = "bar", labelledby }: Props = $props();

  const hidden = $derived(push.state === "unsupported" || push.state === "denied");
</script>

{#if !hidden}
  {#if variant === "row"}
    <button
      type="button"
      role="switch"
      aria-checked={push.state === "subscribed"}
      aria-labelledby={labelledby}
      onclick={() => push.toggle()}
      disabled={push.state === "checking" || push.state === "busy"}
      class="tap inline-flex shrink-0 items-center justify-center cursor-pointer disabled:opacity-50"
    >
      <Switch checked={push.state === "subscribed"} />
    </button>
  {:else if push.state === "subscribed"}
    <button onclick={() => push.toggle()} class="nav-btn border-success-700 text-success-400 hover:bg-surface-800 cursor-pointer">
      Notify ✓
    </button>
  {:else if push.state === "unsubscribed"}
    <button onclick={() => push.toggle()} class="nav-btn nav-btn-muted cursor-pointer">Notify</button>
  {:else}
    <span class="nav-btn nav-btn-muted opacity-50 select-none">Notify</span>
  {/if}
{/if}
