<script lang="ts">
  /**
   * Section switcher and jump list (C3, C6).
   *
   * The report is 600-900 words plus 300-500, so a phone read is several screens with no
   * orientation. This is the orientation: a sticky segmented control that both switches sections
   * and shows which one you are in, plus a jump list of the domains inside Section 1.
   *
   * It anchors to `--header-h`, the measured header height, rather than a hard-coded offset -
   * that is the bug the notes bulk bar had (X6, M8).
   */
  import { onMount } from "svelte";
  import List from "@lucide/svelte/icons/list";
  import type { NavTarget } from "#lib/report/types.js";

  interface Props {
    /** Top-level sections, in reading order. */
    sections: NavTarget[];
    /** Domains inside the briefing, for the jump list. */
    domains: NavTarget[];
    /**
     * `bar` is the sticky pill under the header and hides from `xl`; `rail` is the card the report
     * page puts in its right-hand rail, which only exists from `xl`.
     */
    variant?: "bar" | "rail";
  }

  let { sections, domains, variant = "bar" }: Props = $props();

  // Null until the observer has an opinion, so the first section reads as current on arrival
  // without pinning the initial value of `sections`.
  let observed = $state<string | null>(null);
  const active = $derived(observed ?? sections[0]?.id ?? "");
  let jumpOpen = $state(false);

  onMount(() => {
    const ids = [...sections, ...domains].map((target) => target.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    // The top band under the header is where "current" means something: a section counts as
    // active once its heading passes under the header, not when it first peeks in at the bottom.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            observed = sections.some((section) => section.id === id)
              ? id
              : (sections.find((section) => document.getElementById(section.id)?.contains(entry.target))?.id ?? observed);
          }
        }
      },
      { rootMargin: "-25% 0px -70% 0px", threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  });

  function jump(id: string) {
    jumpOpen = false;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Move focus as well as the viewport, so a keyboard reader lands where the click did.
    document.getElementById(id)?.focus({ preventScroll: true });
  }
</script>

{#if variant === "rail"}
  <div class="rounded-lg border border-surface-800 bg-surface-900 p-1.5">
    <nav aria-label="Report sections" class="flex flex-wrap gap-1">
      {#each sections as section (section.id)}
        <button
          type="button"
          aria-current={active === section.id ? "true" : undefined}
          onclick={() => jump(section.id)}
          class="flex-1 whitespace-nowrap rounded px-2 py-1 text-center text-xs border transition-colors cursor-pointer
            {active === section.id
              ? 'bg-surface-800 border-surface-500 text-surface-50'
              : 'bg-transparent border-transparent text-surface-400 hover:bg-surface-800 hover:text-primary-300'}"
        >
          {section.label}
        </button>
      {/each}
    </nav>
  </div>
{:else}
<div
  class="sticky z-20 w-full sm:w-fit rounded-xl border border-surface-700/60 p-1 xl:hidden
         bg-[color-mix(in_oklab,var(--app-bg)_70%,transparent)] backdrop-blur-md shadow-lg shadow-black/30"
  style="top: calc(var(--header-h) + 0.25rem)"
>
  <div class="flex items-center gap-1 xs:gap-2">
    <!-- Below `sm` the tabs share the row equally and the jump list collapses to an icon, so all
         of them fit without a sideways scroll. From `sm` up they size to their labels. -->
    <nav aria-label="Report sections" class="flex flex-1 items-center gap-0 xs:gap-1 min-w-0 overflow-x-auto sm:flex-none">
      {#each sections as section (section.id)}
        <button
          type="button"
          aria-current={active === section.id ? "true" : undefined}
          onclick={() => jump(section.id)}
          class="tap flex-1 whitespace-nowrap rounded px-0.5 py-1.5 text-center xs:px-1 text-xs border transition-colors cursor-pointer sm:flex-none sm:shrink-0 sm:px-3
            {active === section.id
              ? 'bg-surface-800 border-surface-500 text-surface-50'
              : 'bg-transparent border-transparent text-surface-400 hover:text-surface-200'}"
        >
          {section.label}
        </button>
      {/each}
    </nav>

    {#if domains.length > 0}
      <!-- The rail on `/[date]` shows the same list permanently from `xl` up, so the dropdown
           would be a second, redundant way to do the same thing there. -->
      <div class="relative ml-auto shrink-0 xl:hidden">
        <button
          type="button"
          aria-expanded={jumpOpen}
          aria-label="Jump to a story"
          title="Jump to a story"
          onclick={() => (jumpOpen = !jumpOpen)}
          class="tap flex items-center justify-center rounded border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-xs text-surface-300 hover:text-surface-100 cursor-pointer sm:px-3"
        >
          <List class="h-4 w-4 sm:hidden" aria-hidden="true" />
          <span class="hidden sm:inline" aria-hidden="true">Jump to…</span>
        </button>

        {#if jumpOpen}
          <!-- Closes on a tap anywhere else. A dropdown a thumb cannot dismiss is a trap. -->
          <button
            type="button"
            aria-label="Close the jump list"
            class="fixed inset-0 z-10 cursor-default"
            onclick={() => (jumpOpen = false)}
          ></button>
          <ul
            class="absolute right-0 z-20 mt-1 max-h-[60dvh] w-64 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-2xl"
          >
            {#each domains as domain (domain.id)}
              <li>
                <button
                  type="button"
                  onclick={() => jump(domain.id)}
                  class="tap w-full px-3 py-2 text-left text-xs text-surface-200 hover:bg-surface-800 cursor-pointer bg-transparent border-none"
                >
                  {domain.label}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
</div>
{/if}
