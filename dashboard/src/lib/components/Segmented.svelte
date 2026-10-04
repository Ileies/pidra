<script lang="ts" generics="Key extends string">
  /** A row of equal-width toggle buttons where exactly one is pressed. */
  interface Props {
    options: { key: Key; label: string }[];
    value: Key;
    class?: string;
  }

  let { options, value = $bindable(), class: extra = "" }: Props = $props();
</script>

<div class="grid gap-1.5 {extra}" style:grid-template-columns="repeat({options.length}, minmax(0, 1fr))">
  {#each options as option (option.key)}
    <button
      type="button"
      aria-pressed={value === option.key}
      onclick={() => (value = option.key)}
      class="tap nav-btn text-center {value === option.key ? 'nav-btn-active' : 'nav-btn-muted'}"
    >{option.label}</button>
  {/each}
</div>
