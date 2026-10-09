<script lang="ts">
  /**
   * The second filter row on /notes: how narrow a note is, which step can read it, who it targets, and
   * the ones no briefing step has loaded lately. Narrowness is derived from the note's fields
   * (`narrownessOf`), never stored, so these are views over the same notes the scope chips show.
   */
  import { NARROWNESS, DORMANT_DAYS, type Narrowness } from "$pipeline/notes/narrowness";
  import { NOTE_STEPS } from "$pipeline/notes/steps";
  import { label } from "#lib/labels.js";
  import type { NotesFilter } from "#lib/offline/repo.js";
  import { STEP_HINT } from "#lib/notes/targeting.js";

  interface Props {
    filter: NotesFilter;
    /** Active notes with no load in the last `DORMANT_DAYS` days. */
    dormantCount: number;
    onchange: (patch: Partial<NotesFilter>) => void;
  }

  let { filter, dormantCount, onchange }: Props = $props();

  const KIND_LABEL: Record<Narrowness, string> = {
    always: "Always",
    step: "Step-bound",
    targeted: "Targeted",
    dated: "Dated",
  };
  const KIND_HINT: Record<Narrowness, string> = {
    always: "No steps and no targets: loads wherever its scope reaches.",
    step: "Loads only in the steps it names.",
    targeted: "Loads only for items from a named sender, entity or keyword.",
    dated: "Has a start or an expiry day.",
  };

  const chipBase = "chip shrink-0 inline-flex items-center gap-1.5";
  const chipIdle = "border-surface-700 bg-surface-950 text-surface-300 hover:bg-surface-800";
  const chipActive = "border-primary-800 bg-primary-950 text-primary-300";
</script>

<div class="flex flex-col gap-2 lg:flex-row lg:items-center">
  <div role="group" aria-label="Filter by how narrow" class="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
    {#each NARROWNESS as kind (kind)}
      <button
        type="button"
        onclick={() => onchange({ narrowness: filter.narrowness === kind ? "" : kind })}
        aria-pressed={filter.narrowness === kind}
        title={KIND_HINT[kind]}
        class="{chipBase} {filter.narrowness === kind ? chipActive : chipIdle}"
      >{KIND_LABEL[kind]}</button>
    {/each}
    <button
      type="button"
      onclick={() => onchange({ dormant: !filter.dormant })}
      aria-pressed={filter.dormant}
      title="No briefing step has read the note in the last {DORMANT_DAYS} days. A note that is too narrow shows up here."
      class="{chipBase} {filter.dormant ? chipActive : chipIdle}"
    >Not loaded in {DORMANT_DAYS} days <span class="tabular-nums opacity-70">{dormantCount}</span></button>
  </div>

  <div class="flex min-w-0 items-center gap-2 lg:ml-auto">
    <select
      value={filter.step}
      onchange={(event) => onchange({ step: event.currentTarget.value })}
      aria-label="Notes a step can read"
      class="input-base min-w-0 flex-1 py-1 text-xs lg:flex-none"
    >
      <option value="">Any step</option>
      {#each NOTE_STEPS as step (step)}
        <option value={step}>{label(step)}: {STEP_HINT[step]}</option>
      {/each}
    </select>
    <input
      type="search"
      value={filter.target}
      oninput={(event) => onchange({ target: event.currentTarget.value })}
      placeholder="Sender or entity…"
      aria-label="Filter by targeted sender, entity or keyword"
      class="input-base min-w-0 flex-1 py-1 text-xs lg:flex-none [&::-webkit-search-cancel-button]:appearance-none"
    />
  </div>
</div>
