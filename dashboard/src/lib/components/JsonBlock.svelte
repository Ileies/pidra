<script lang="ts">
  /** A value as indented JSON in a scrolling box, e.g. a skill call's parameters. */
  interface Props {
    value: unknown;
    class?: string;
  }

  let { value, class: extra = "" }: Props = $props();
</script>

<pre class="text-xs text-surface-200 bg-surface-950 border border-surface-800 rounded px-3 py-2 overflow-x-auto {extra}">{JSON.stringify(value, null, 2)}</pre>
