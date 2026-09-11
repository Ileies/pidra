<script lang="ts">
  /**
   * The skill registry and the execution log.
   *
   * This was two four-column tables plus an edit form in a `colspan="4"` row with fixed-width
   * fields (`w-44`, `w-32`), which is unusable on a phone (M-4, M-5). Both are expandable cards
   * now: a registry entry is an object with a name and some facts about it, and the editor is a
   * full-width panel rather than a cell.
   */
  import { enhance } from "$app/forms";
  import Page from "$lib/components/Page.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { fmtDateTimeShort } from "$lib/format";
  import { label as displayLabel } from "$lib/labels";
  import { toastFormResult } from "$lib/toast.svelte";
  import type { SkillInfo } from "./+page.server";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  const RISK_OPTIONS = ["low", "medium", "high", "critical"] as const;
  const RISK_LEVELS = ["all", ...RISK_OPTIONS] as const;
  type RiskFilter = (typeof RISK_LEVELS)[number];

  const RISK_TONE = {
    low: "success",
    medium: "warning",
    high: "error",
    critical: "error",
  } as const;

  const STATUS_TONE = {
    pending: "warning",
    executed: "success",
    failed: "error",
    rejected: "muted",
  } as const;

  let usageBySkill = $derived.by(() => {
    const map = new Map<string, { count: number; lastAt: string }>();
    for (const exec of data.executions) {
      const existing = map.get(exec.skill_name);
      if (existing) existing.count += 1;
      else map.set(exec.skill_name, { count: 1, lastAt: exec.created_at });
    }
    return map;
  });

  let searchQuery = $state("");
  let riskFilter = $state<RiskFilter>("all");

  let riskCounts = $derived.by(() => {
    const counts: Record<string, number> = { all: data.skills.length, low: 0, medium: 0, high: 0, critical: 0 };
    for (const skill of data.skills) counts[skill.risk_level] = (counts[skill.risk_level] ?? 0) + 1;
    return counts;
  });

  let filteredSkills = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.skills
      .filter((skill) => riskFilter === "all" || skill.risk_level === riskFilter)
      .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  let expandedSkills = $state<Record<string, boolean>>({});
  let expandedExecs = $state<Record<string, boolean>>({});

  function params(skill: SkillInfo) {
    return Object.entries(skill.parameters ?? {});
  }
</script>

<Page title="Skills" size="app" class="flex flex-col gap-8">
  <!-- The approval queue (D4). A high-risk call is inserted as `pending` and waits for the
       owner; until now nothing on this page could complete that decision, so the documented
       workflow had no UI. It leads the page because it is the one thing here that blocks. -->
  {#if data.pending.length > 0}
    <section class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold text-warning-400">
        Waiting for you ({data.pending.length})
      </h2>
      <p class="text-xs text-surface-400 max-w-prose">
        High-risk calls do not run on their own. Confirming runs the skill now, with the
        parameters below; everything is re-checked at that point, so a skill disabled or raised to
        critical since it was queued will be refused rather than run.
      </p>

      <ul class="flex flex-col gap-2">
        {#each data.pending as execution (execution.id)}
          <li class="rounded-lg border border-warning-800 bg-warning-950/40 px-4 py-3 flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-sm text-surface-100 break-all">{execution.skill_name}</span>
              <Badge tone="warning">Pending</Badge>
              <span class="text-xs text-surface-400">{execution.triggered_by ?? "-"}</span>
              <span class="text-xs text-surface-400 ml-auto whitespace-nowrap">{fmtDateTimeShort(execution.created_at)}</span>
            </div>

            {#if execution.parameters && Object.keys(execution.parameters).length > 0}
              <pre class="text-xs text-surface-200 bg-surface-950 border border-surface-800 rounded px-3 py-2 overflow-x-auto">{JSON.stringify(execution.parameters, null, 2)}</pre>
            {/if}

            <form method="POST" action="?/resolve" use:enhance class="flex flex-col sm:flex-row sm:items-center gap-2">
              <input type="hidden" name="id" value={execution.id} />
              <input
                type="text"
                name="reason"
                placeholder="Reason (optional, recorded on a rejection)"
                aria-label="Rejection reason"
                class="input-base flex-1"
              />
              <div class="flex gap-2">
                <button
                  type="submit"
                  name="decision"
                  value="confirm"
                  class="tap flex-1 px-4 py-1.5 rounded text-xs bg-success-800 border border-success-600 text-success-100 hover:bg-success-700 cursor-pointer transition-colors"
                >Confirm and run</button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  class="tap flex-1 px-4 py-1.5 rounded text-xs bg-surface-900 border border-error-700 text-error-400 hover:bg-surface-950 cursor-pointer transition-colors"
                >Reject</button>
              </div>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-xl font-bold text-surface-50">
        Registered skills <span class="text-surface-400 font-normal text-base">({data.skills.length})</span>
      </h1>

      <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        <input
          type="search"
          placeholder="Search skills…"
          aria-label="Search skills"
          bind:value={searchQuery}
          class="input-base flex-1 sm:w-48 sm:flex-none"
        />
        <div class="flex items-center gap-1 flex-wrap">
          {#each RISK_LEVELS as level (level)}
            <button
              type="button"
              aria-pressed={riskFilter === level}
              class="tap px-2.5 py-1 rounded text-xs border transition-colors cursor-pointer
                {riskFilter === level
                  ? 'bg-surface-700 border-surface-500 text-surface-50'
                  : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200'}"
              onclick={() => (riskFilter = level)}
            >
              {level} <span class="opacity-70">{riskCounts[level] ?? 0}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    {#if filteredSkills.length === 0}
      <EmptyState title="No skills match." compact />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each filteredSkills as skill (skill.name)}
          {@const open = !!expandedSkills[skill.name]}
          {@const usage = usageBySkill.get(skill.name)}
          <li class="rounded-lg border border-surface-700 bg-surface-900 {skill.enabled ? '' : 'opacity-60'}">
            <button
              type="button"
              aria-expanded={open}
              onclick={() => (expandedSkills[skill.name] = !open)}
              class="tap w-full text-left px-4 py-3 flex flex-col gap-1.5 cursor-pointer bg-transparent border-none"
            >
              <span class="flex items-center gap-2 flex-wrap">
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  class="w-3 h-3 shrink-0 text-surface-400 transition-transform {open ? 'rotate-90' : ''}"
                  aria-hidden="true"
                ><path d="M7 5l6 5-6 5V5z" /></svg>
                <span class="font-mono text-surface-100 text-sm break-all">{skill.name}</span>
                <!-- The risk level was a 6px coloured dot with a title=. On a touch device that
                     is nothing at all (P7, M13), so it is a word with a hue behind it. -->
                <Badge tone={RISK_TONE[skill.risk_level] ?? "muted"}>{skill.risk_level}</Badge>
                {#if !skill.enabled}<Badge tone="muted">Disabled</Badge>{/if}
                {#if skill.overridden}<Badge tone="primary">Edited</Badge>{/if}
              </span>
              <span class="text-sm text-surface-300">{skill.description}</span>
              <span class="text-xs text-surface-400">
                {#if usage}
                  {usage.count}x · last {fmtDateTimeShort(usage.lastAt)}
                {:else}
                  Not used yet
                {/if}
              </span>
            </button>

            {#if open}
              <div class="border-t border-surface-800 px-4 py-4 bg-surface-950 rounded-b-lg">
                {#if skill.overridden}
                  <p class="text-xs text-surface-400 mb-3">
                    Changed from the default: risk <span class="text-surface-200">{skill.base.risk_level}</span>,
                    description <span class="text-surface-200">"{skill.base.description}"</span>.
                  </p>
                {/if}

                <form method="POST" action="?/update" use:enhance class="flex flex-col gap-3 max-w-2xl">
                  <input type="hidden" name="skillName" value={skill.name} />

                  <label class="tap-check text-sm text-surface-200 w-fit">
                    <input type="checkbox" name="enabled" value="true" checked={skill.enabled} class="accent-primary-500 h-4 w-4" />
                    Enabled
                  </label>

                  <label class="flex flex-col gap-1 text-xs text-surface-400">
                    Risk level
                    <select name="riskLevel" value={skill.risk_level} class="input-base w-full sm:w-52">
                      {#each RISK_OPTIONS as level (level)}
                        <option value={level}>{level}{level === skill.base.risk_level ? " (default)" : ""}</option>
                      {/each}
                    </select>
                  </label>

                  <label class="flex flex-col gap-1 text-xs text-surface-400">
                    Description
                    <textarea name="description" rows="2" class="input-base resize-y">{skill.description}</textarea>
                  </label>

                  {#if params(skill).length > 0}
                    <div class="flex flex-col gap-1.5">
                      <span class="text-xs text-surface-400">Parameter descriptions</span>
                      {#each params(skill) as [paramName, param] (paramName)}
                        <label class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs">
                          <span class="font-mono text-surface-300 sm:w-32 shrink-0 truncate" title={paramName}>
                            {paramName}{#if param.required}<span class="text-error-400">*</span>{/if}
                          </span>
                          <input
                            type="text"
                            name="param:{paramName}"
                            value={param.description ?? ""}
                            aria-label="Description for {paramName}"
                            class="input-base flex-1"
                          />
                        </label>
                      {/each}
                    </div>
                  {:else}
                    <p class="text-xs text-surface-400">No parameters.</p>
                  {/if}

                  <div class="flex flex-wrap items-center gap-2 mt-1">
                    <button
                      type="submit"
                      class="tap px-4 py-1.5 rounded text-xs bg-primary-700 border border-primary-600 text-primary-50 hover:bg-primary-600 transition-colors cursor-pointer"
                    >Save</button>
                    {#if skill.overridden}
                      <button
                        formaction="?/reset"
                        type="submit"
                        class="tap px-4 py-1.5 rounded text-xs border border-surface-500 text-surface-300 hover:text-error-400 hover:border-error-500 transition-colors cursor-pointer"
                      >Reset to default</button>
                    {/if}
                  </div>
                </form>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold text-surface-100">Recent executions</h2>

    {#if data.executions.length === 0}
      <EmptyState title="No skill executions yet." compact />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each data.executions as exec (exec.id)}
          {@const open = !!expandedExecs[exec.id]}
          <li class="rounded-lg border border-surface-800 bg-surface-900">
            <button
              type="button"
              aria-expanded={open}
              onclick={() => (expandedExecs[exec.id] = !open)}
              class="tap w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-2 cursor-pointer bg-transparent border-none"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                class="w-3 h-3 shrink-0 text-surface-400 transition-transform {open ? 'rotate-90' : ''}"
                aria-hidden="true"
              ><path d="M7 5l6 5-6 5V5z" /></svg>
              <span class="font-mono text-surface-100 text-sm break-all">{exec.skill_name}</span>
              <Badge tone={STATUS_TONE[exec.status as keyof typeof STATUS_TONE] ?? "muted"}>
                {displayLabel(exec.status)}
              </Badge>
              <span class="text-xs text-surface-400">{exec.triggered_by ?? "-"}</span>
              <span class="text-xs text-surface-400 ml-auto whitespace-nowrap">{fmtDateTimeShort(exec.created_at)}</span>
            </button>

            {#if open}
              <div class="border-t border-surface-800 px-4 py-3 bg-surface-950 rounded-b-lg">
                {#if exec.parameters && Object.keys(exec.parameters).length > 0}
                  <pre class="text-xs text-surface-200 bg-surface-950 border border-surface-800 rounded px-3 py-2 overflow-x-auto mb-2">{JSON.stringify(exec.parameters, null, 2)}</pre>
                {/if}
                {#if exec.result}
                  <p class="text-sm {exec.status === 'failed' ? 'text-error-400' : 'text-surface-200'} break-words">{exec.result}</p>
                {/if}
                <p class="text-xs text-surface-400 mt-2 break-all">{exec.run_date} · id {exec.id}</p>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</Page>
