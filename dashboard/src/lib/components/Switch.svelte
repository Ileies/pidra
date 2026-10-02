<script lang="ts">
  /**
   * The visual of an on/off switch, nothing more: the caller owns the control around it (a
   * checkbox inside a label, or a role="switch" button). The thumb lives inside the track as a flex
   * child, never absolutely positioned, so a taller hit area around it (`tap`) can't pull the two
   * apart.
   */
  interface Props {
    checked: boolean;
  }

  let { checked }: Props = $props();
</script>

<span
  class="flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors {checked ? 'bg-success-700' : 'bg-surface-700'}"
>
  <span
    class="block size-5 rounded-full bg-surface-100 shadow transition-transform {checked ? 'translate-x-5' : 'translate-x-0'}"
  ></span>
</span>
