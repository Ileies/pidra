<script lang="ts">
  /**
   * The red number on a nav control: how many things inside it are waiting. Renders nothing at 0.
   * It is `aria-hidden`; the caller puts the spoken version ("3 waiting for you") in its own label.
   */
  interface Props {
    count: number;
    class?: string;
  }

  let { count, class: extra = "" }: Props = $props();
</script>

{#if count > 0}
  <span class="min-w-5 rounded-full bg-(--app-solid-error) px-1 text-center text-[10px] font-bold leading-5 text-white tabular-nums {extra}" aria-hidden="true">{count > 99 ? "99+" : count}</span>
{/if}
