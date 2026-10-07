<script lang="ts">
  /**
   * The "where it loads" part of the note editor: which steps read the note, which senders, entities or
   * keywords it is for, and the day it starts. Empty everywhere means it loads wherever its scope
   * reaches. Collapsed unless the note is already narrowed, so a plain note's editor stays short.
   */
  import { NOTE_STEPS } from "$pipeline/notes/steps";
  import type { Draft } from "#lib/notes/api.js";
  import { label } from "#lib/labels.js";
  import { STEP_HINT, TARGET_FIELDS } from "#lib/notes/targeting.js";

  interface Props {
    draft: Draft;
  }

  let { draft = $bindable() }: Props = $props();

  const narrowed = $derived(
    draft.steps.length > 0 || draft.senders !== "" || draft.entities !== "" || draft.keywords !== "" || draft.activeFrom !== "",
  );

  function toggle(step: string) {
    draft.steps = draft.steps.includes(step) ? draft.steps.filter((s) => s !== step) : [...draft.steps, step];
  }
</script>

<details class="group text-xs text-surface-400" open={narrowed}>
  <summary class="cursor-pointer select-none py-1 hover:text-surface-200">
    Where it loads{narrowed ? "" : ": everywhere its scope reaches"}
  </summary>

  <div class="flex flex-col gap-3 pt-2">
    <div class="flex flex-col gap-1.5">
      <span id="steps-label">Steps <span class="opacity-70">(none picked means all)</span></span>
      <div role="group" aria-labelledby="steps-label" class="flex flex-wrap gap-1.5">
        {#each NOTE_STEPS as step (step)}
          {@const active = draft.steps.includes(step)}
          <button
            type="button"
            aria-pressed={active}
            title={STEP_HINT[step]}
            onclick={() => toggle(step)}
            disabled={draft.saving}
            class="tap badge border transition-colors {active
              ? 'border-primary-800 bg-primary-950 text-primary-300'
              : 'text-surface-400 bg-transparent border-surface-700 hover:bg-surface-800'}"
          >{label(step)}</button>
        {/each}
      </div>
    </div>

    <div class="grid gap-2 sm:grid-cols-3">
      {#each TARGET_FIELDS as field (field.key)}
        <label class="flex min-w-0 flex-col gap-1">
          <span>{field.label} <span class="opacity-70">(comma-separated)</span></span>
          <input
            type="text"
            bind:value={draft[field.key]}
            disabled={draft.saving}
            placeholder={field.hint}
            class="input-base-flush w-full"
          />
        </label>
      {/each}
    </div>

    <label class="flex items-center gap-2">
      Starts
      <input type="date" bind:value={draft.activeFrom} disabled={draft.saving} class="input-base-flush" />
      {#if draft.activeFrom}
        <button type="button" onclick={() => (draft.activeFrom = "")} class="btn btn-ghost px-2.5 py-1">At once</button>
      {/if}
    </label>

    <p>A note with a sender, entity or keyword loads only for items that match all the lists you fill in. Stages without a single item, such as the two sections, never load it.</p>
  </div>
</details>
