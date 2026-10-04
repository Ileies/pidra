<script lang="ts">
  /**
   * An on/off switch. The thumb lives inside the track as a flex child, never absolutely
   * positioned, so a taller hit area around it (`tap`) can't pull the two apart.
   *
   * Without `name` it is only the visual and the caller owns the control around it (a
   * role="switch" button). With `name` it renders its own labelled checkbox: `autosubmit` posts
   * the surrounding form the moment it flips, `onchange` is for anything else.
   */
  interface Props {
    checked: boolean;
    name?: string;
    label?: string;
    title?: string;
    autosubmit?: boolean;
    onchange?: (checked: boolean) => void;
  }

  let { checked, name, label, title, autosubmit = false, onchange }: Props = $props();
</script>

{#snippet track()}
  <span
    class="flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors {checked ? 'bg-success-700' : 'bg-surface-700'}"
  >
    <span
      class="block size-5 rounded-full bg-surface-100 shadow transition-transform {checked ? 'translate-x-5' : 'translate-x-0'}"
    ></span>
  </span>
{/snippet}

{#if name}
  <label class="tap inline-flex cursor-pointer items-center justify-center" {title}>
    <input
      type="checkbox"
      {name}
      value="true"
      {checked}
      aria-label={label}
      onchange={(event) => {
        if (autosubmit) event.currentTarget.form?.requestSubmit();
        onchange?.(event.currentTarget.checked);
      }}
      class="sr-only peer"
    />
    {@render track()}
  </label>
{:else}
  {@render track()}
{/if}
