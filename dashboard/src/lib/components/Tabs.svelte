<script lang="ts" generics="Key extends string">
  /** Underline tabs. Each tab is `tab-{key}` and controls the panel `panel-{key}` the caller renders. */
  interface Props {
    tabs: { key: Key; label: string }[];
    value: Key;
    label: string;
  }

  let { tabs, value = $bindable(), label }: Props = $props();
</script>

<div role="tablist" aria-label={label} class="flex gap-4 border-b border-surface-800">
  {#each tabs as tab (tab.key)}
    <button
      type="button"
      role="tab"
      id="tab-{tab.key}"
      aria-selected={value === tab.key}
      aria-controls="panel-{tab.key}"
      class="tap pb-2 text-sm border-b-2 -mb-px transition-colors {value === tab.key
        ? 'border-primary-500 text-surface-50 font-medium'
        : 'border-transparent text-surface-400 hover:text-surface-200'}"
      onclick={() => (value = tab.key)}
    >{tab.label}</button>
  {/each}
</div>
