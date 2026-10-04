<script lang="ts">
  /**
   * The width the wide-desktop grid frees up, put to use instead of left as margin: the same
   * figures the (`xl:hidden`) stats bar shows, the open quick actions collected in one place, and
   * a permanent copy of `SectionNav`'s domain dropdown. Sticky, so it stays in view while the
   * article scrolls past it.
   */
  import SectionNav from "#lib/report/SectionNav.svelte";
  import { jumpToSection } from "#lib/report/jump.js";
  import { ACTION_META, type NavTarget, type QuickAction } from "#lib/report/types.js";

  interface Props {
    date: string;
    stats: { label: string; value: string; title?: string }[];
    openActions: QuickAction[];
    sectionTargets: NavTarget[];
    domainTargets: NavTarget[];
    structured: boolean;
  }

  let { date, stats, openActions, sectionTargets, domainTargets, structured }: Props = $props();
</script>

<aside
  class="hidden xl:flex xl:flex-col xl:gap-4 xl:sticky xl:overflow-y-auto xl:overscroll-contain"
  style="top: calc(var(--header-h) + 1.5rem); max-height: calc(100dvh - var(--header-h) - 3rem)"
>
  <div class="flex flex-col gap-2 rounded-lg border border-surface-800 bg-surface-900 p-4">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-surface-400">Run stats</h2>
    <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {#each stats as stat (stat.label)}
        <div class="flex items-baseline justify-between gap-3 text-sm" title={stat.title}>
          <dt class="text-surface-400 truncate">{stat.label}</dt>
          <dd class="font-semibold text-surface-50 tabular-nums shrink-0">{stat.value}</dd>
        </div>
      {/each}
    </dl>
    <a href="/{date}/triage" class="text-xs text-primary-400 no-underline hover:text-primary-300 mt-1">
      What was left out? →
    </a>
  </div>

  {#if openActions.length > 0}
    <div class="flex flex-col gap-2 rounded-lg border border-surface-800 bg-surface-900 p-4">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-surface-400">Open actions</h2>
      <ul class="flex flex-col gap-1.5 text-sm text-surface-300">
        {#each openActions as action (action.id)}
          <li>{ACTION_META[action.preview.kind].verb}: {action.preview.title}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if structured && sectionTargets.length > 1}
    <SectionNav variant="rail" sections={sectionTargets} domains={domainTargets} />
  {/if}

  {#if domainTargets.length > 0}
    <div class="flex flex-col gap-2 rounded-lg border border-surface-800 bg-surface-900 p-4">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-surface-400">Jump to a story</h2>
      <ul class="flex flex-col gap-0.5">
        {#each domainTargets as target (target.id)}
          <li>
            <button
              type="button"
              onclick={() => jumpToSection(target.id)}
              class="w-full rounded px-2 py-1 text-left text-sm text-surface-300 hover:bg-surface-800 hover:text-primary-300 bg-transparent border-none"
            >
              {target.label}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</aside>
