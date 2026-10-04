<script lang="ts">
  /**
   * The two-step confirm, in one place (B2).
   *
   * /sources and /sources/[name] each carried their own copy: a trigger, an optional reason
   * field, a Confirm and a Cancel, all `px-2.5 py-1` and laid out in a row that does not fit a
   * phone. Here the armed state stacks full-width below `sm` (M-3) and every control is a real
   * target.
   */
  import { enhance } from "$app/forms";

  interface Props {
    /** Resting label, e.g. "Disable". */
    label: string;
    confirmLabel?: string;
    /** Form action, e.g. "?/toggle". */
    action: string;
    /** Hidden inputs submitted with the confirmation. */
    fields?: Record<string, string>;
    /** When set, an optional free-text reason is captured into a hidden field of this name. */
    reasonName?: string;
    reasonPlaceholder?: string;
    tone?: "error" | "success";
    /** Skips the confirmation step entirely - for the reversible direction of a toggle. */
    immediate?: boolean;
    /** `"input"` matches `input-base`'s box model exactly, for a trigger that sits in the same
     *  row as text fields (e.g. a per-row Save) and would otherwise read as a smaller, different
     *  kind of control there. Default `"xs"` is every other call site, unchanged. */
    size?: "xs" | "input";
    /** Runs after a successful submit, once `update()` has applied the result - for a caller
     *  that has client-side state of its own to reconcile (e.g. the active row was just deleted). */
    onSuccess?: () => void;
    /** Renders the resting trigger as a borderless trash icon (`label` becomes its tooltip and
     *  accessible name), to sit beside other icon buttons. The armed Confirm/Cancel stays text. */
    icon?: boolean;
  }

  let {
    label,
    confirmLabel = "Confirm",
    action,
    fields = {},
    reasonName,
    reasonPlaceholder = "Reason (optional)",
    tone = "error",
    immediate = false,
    size = "xs",
    onSuccess,
    icon = false,
  }: Props = $props();

  let armed = $state(false);
  let reason = $state("");

  function disarm() {
    armed = false;
    reason = "";
  }

  const SIZE = { xs: "px-3 py-1.5 text-xs", input: "px-3 py-2 sm:py-1.5 text-base sm:text-sm" } as const;

  const TRIGGER = {
    error: "border-surface-500 text-surface-300 hover:border-error-500 hover:text-error-400",
    success: "border-success-600 text-success-400 hover:bg-success-950",
  } as const;

  const CONFIRM = {
    error: "bg-error-800 border-error-600 text-error-100 hover:bg-error-700",
    success: "bg-success-800 border-success-600 text-success-100 hover:bg-success-700",
  } as const;
</script>

{#if immediate}
  <form
    method="POST"
    {action}
    use:enhance={() => async ({ update, result }) => {
      await update();
      if (result.type === "success") onSuccess?.();
    }}
  >
    {#each Object.entries(fields) as [name, value] (name)}
      <input type="hidden" {name} {value} />
    {/each}
    <button type="submit" class="tap rounded border bg-transparent transition-colors {SIZE[size]} {TRIGGER[tone]}">
      {label}
    </button>
  </form>
{:else if !armed && icon}
  <button
    type="button"
    onclick={() => (armed = true)}
    title={label}
    aria-label={label}
    class="tap inline-flex items-center justify-center text-surface-500 hover:text-error-400 transition-colors"
  >
    <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
  </button>
{:else if !armed}
  <button
    type="button"
    onclick={() => (armed = true)}
    class="tap rounded border bg-transparent transition-colors {SIZE[size]} {TRIGGER[tone]}"
  >
    {label}
  </button>
{:else}
  <form
    method="POST"
    {action}
    use:enhance={() => async ({ update, result }) => {
      disarm();
      await update();
      if (result.type === "success") onSuccess?.();
    }}
    class="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto"
  >
    {#each Object.entries(fields) as [name, value] (name)}
      <input type="hidden" {name} {value} />
    {/each}
    {#if reasonName}
      <input type="hidden" name={reasonName} value={reason} />
      <input
        type="text"
        placeholder={reasonPlaceholder}
        bind:value={reason}
        aria-label={reasonPlaceholder}
        class="input-base w-full sm:w-40"
      />
    {/if}
    <div class="flex gap-2">
      <button
        type="submit"
        class="tap flex-1 px-3 py-1.5 rounded text-xs border transition-colors {CONFIRM[tone]}"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onclick={disarm}
        class="tap flex-1 px-3 py-1.5 rounded text-xs border border-surface-500 text-surface-300 bg-transparent hover:text-surface-100 transition-colors"
      >
        Cancel
      </button>
    </div>
  </form>
{/if}
