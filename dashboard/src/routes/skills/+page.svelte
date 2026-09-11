<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();

  const RISK_OPTIONS = ["low", "medium", "high", "critical"] as const;

  const STATUS_CLASS: Record<string, string> = {
    pending: "text-warning-400 bg-warning-950 border-warning-700",
    executed: "text-success-400 bg-success-950 border-success-700",
    failed: "text-error-400 bg-error-950 border-error-700",
    rejected: "text-surface-500 bg-surface-900 border-surface-700",
  };

  const RISK_DOT: Record<string, string> = {
    low: "bg-success-500",
    medium: "bg-warning-500",
    high: "bg-error-500",
    critical: "bg-error-500",
  };

  const RISK_LEVELS = ["all", "low", "medium", "high", "critical"] as const;
  type RiskFilter = (typeof RISK_LEVELS)[number];

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

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
      .filter((s) => riskFilter === "all" || s.risk_level === riskFilter)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  let expandedSkills = $state<Record<string, boolean>>({});
  function toggleSkill(name: string) {
    expandedSkills[name] = !expandedSkills[name];
  }
  function rowKeydown(e: KeyboardEvent, fn: () => void) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  }

  let expandedExecs = $state<Record<string, boolean>>({});
  function toggleExec(id: string) {
    expandedExecs[id] = !expandedExecs[id];
  }
</script>

<svelte:head>
  <title>PIDRA - Skills</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0">
  <main class="flex-1 max-w-6xl w-full mx-auto px-8 py-6 pb-16 flex flex-col gap-8">
    <section>
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <h1 class="text-xl font-bold text-surface-50">
          Registered skills <span class="text-surface-600 font-normal text-base">({data.skills.length})</span>
        </h1>

        <div class="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search..."
            bind:value={searchQuery}
            class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-sm px-3 py-1.5 w-48 focus:outline-none focus:border-surface-500"
          />
          <div class="flex items-center gap-1">
            {#each RISK_LEVELS as level}
              <button
                type="button"
                class="px-2.5 py-1 rounded text-xs border transition-colors cursor-pointer
                  {riskFilter === level ? 'bg-surface-700 border-surface-600 text-surface-50' : 'border-surface-800 text-surface-500 hover:border-surface-700 hover:text-surface-300'}"
                onclick={() => (riskFilter = level)}
              >
                {level} <span class="opacity-60">{riskCounts[level] ?? 0}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>

      {#if filteredSkills.length === 0}
        <p class="text-surface-500 text-sm py-6">No skills match.</p>
      {:else}
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Skill</th>
              <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Risk</th>
              <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700">Description</th>
              <th class="text-right px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Usage</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredSkills as skill}
              {@const usage = usageBySkill.get(skill.name)}
              {@const params = Object.entries(skill.parameters ?? {})}
              {@const open = !!expandedSkills[skill.name]}
              <tr
                class="cursor-pointer hover:bg-surface-900/70 transition-colors"
                class:bg-surface-900={open}
                class:opacity-50={!skill.enabled}
                tabindex="0"
                role="button"
                aria-expanded={open}
                onclick={() => toggleSkill(skill.name)}
                onkeydown={(e) => rowKeydown(e, () => toggleSkill(skill.name))}
              >
                <td class="px-3 py-2 border-b border-surface-800">
                  <span class="inline-flex items-center gap-1.5">
                    <svg
                      viewBox="0 0 20 20" fill="currentColor"
                      class="w-3 h-3 shrink-0 text-surface-600 transition-transform {open ? 'rotate-90' : ''}"
                    ><path d="M7 5l6 5-6 5V5z" /></svg>
                    <span class="font-mono text-surface-100">{skill.name}</span>
                    {#if !skill.enabled}
                      <span class="badge text-xs border text-surface-500 bg-surface-900 border-surface-700">disabled</span>
                    {/if}
                    {#if skill.overridden}
                      <span class="w-1.5 h-1.5 rounded-full bg-primary-500" title="Edited from default"></span>
                    {/if}
                  </span>
                </td>
                <td class="px-3 py-2 border-b border-surface-800 whitespace-nowrap">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full {RISK_DOT[skill.risk_level] ?? 'bg-surface-600'}"></span>
                    <span class="text-xs text-surface-500">{skill.risk_level}</span>
                  </span>
                </td>
                <td class="px-3 py-2 border-b border-surface-800 text-surface-300">{skill.description}</td>
                <td class="px-3 py-2 border-b border-surface-800 text-right whitespace-nowrap text-xs">
                  {#if usage}
                    <span class="text-surface-400">{usage.count}x · {fmtDate(usage.lastAt)}</span>
                  {:else}
                    <span class="text-surface-500 italic">not used yet</span>
                  {/if}
                </td>
              </tr>
              {#if open}
                <tr class="bg-surface-950">
                  <td colspan="4" class="px-3 pl-9 py-4 border-b border-surface-800">
                    <form method="POST" action="?/update" use:enhance class="flex flex-col gap-3 max-w-2xl">
                      <input type="hidden" name="skillName" value={skill.name} />

                      <label class="flex items-center gap-2 text-sm text-surface-300 cursor-pointer w-fit">
                        <input type="checkbox" name="enabled" value="true" checked={skill.enabled} class="accent-primary-500" />
                        Enabled
                      </label>

                      <label class="flex flex-col gap-1 text-xs text-surface-500">
                        Risk level
                        <select
                          name="riskLevel"
                          value={skill.risk_level}
                          class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-sm px-2 py-1.5 w-44"
                        >
                          {#each RISK_OPTIONS as level}
                            <option value={level}>{level}{level === skill.base.risk_level ? " (default)" : ""}</option>
                          {/each}
                        </select>
                      </label>

                      <label class="flex flex-col gap-1 text-xs text-surface-500">
                        Description
                        <textarea
                          name="description"
                          rows="2"
                          class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-sm px-2 py-1.5 resize-y"
                        >{skill.description}</textarea>
                      </label>

                      {#if params.length > 0}
                        <div class="flex flex-col gap-1.5">
                          <span class="text-xs text-surface-500">Parameter descriptions</span>
                          {#each params as [paramName, param]}
                            <label class="flex items-center gap-2 text-xs">
                              <span class="font-mono text-surface-400 w-32 shrink-0 truncate" title={paramName}>
                                {paramName}{#if param.required}<span class="text-error-400">*</span>{/if}
                              </span>
                              <input
                                type="text"
                                name="param:{paramName}"
                                value={param.description ?? ""}
                                class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-sm px-2 py-1 flex-1"
                              />
                            </label>
                          {/each}
                        </div>
                      {:else}
                        <p class="text-xs text-surface-600">No parameters.</p>
                      {/if}

                      <div class="flex items-center gap-2 mt-1">
                        <button type="submit" class="px-3 py-1.5 rounded text-xs bg-primary-600 text-white hover:opacity-90 transition-opacity cursor-pointer">
                          Save
                        </button>
                        {#if skill.overridden}
                          <button
                            formaction="?/reset"
                            type="submit"
                            class="px-3 py-1.5 rounded text-xs border border-surface-700 text-surface-400 hover:text-error-400 hover:border-error-500 transition-colors cursor-pointer"
                          >
                            Reset to default
                          </button>
                        {/if}
                      </div>
                    </form>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section>
      <h2 class="text-lg font-semibold text-surface-100 mb-3">Recent executions</h2>

      {#if data.executions.length === 0}
        <p class="text-surface-500 text-sm py-6">No skill executions yet.</p>
      {:else}
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Skill</th>
              <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Status</th>
              <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700">Triggered by</th>
              <th class="text-right px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Time</th>
            </tr>
          </thead>
          <tbody>
            {#each data.executions as exec}
              {@const open = !!expandedExecs[exec.id]}
              <tr
                class="cursor-pointer hover:bg-surface-900/70 transition-colors"
                class:bg-surface-900={open}
                tabindex="0"
                role="button"
                aria-expanded={open}
                onclick={() => toggleExec(exec.id)}
                onkeydown={(e) => rowKeydown(e, () => toggleExec(exec.id))}
              >
                <td class="px-3 py-2 border-b border-surface-800">
                  <span class="inline-flex items-center gap-1.5">
                    <svg
                      viewBox="0 0 20 20" fill="currentColor"
                      class="w-3 h-3 shrink-0 text-surface-600 transition-transform {open ? 'rotate-90' : ''}"
                    ><path d="M7 5l6 5-6 5V5z" /></svg>
                    <span class="font-mono text-surface-100">{exec.skill_name}</span>
                  </span>
                </td>
                <td class="px-3 py-2 border-b border-surface-800 whitespace-nowrap">
                  <span class="badge text-xs border {STATUS_CLASS[exec.status] ?? 'text-surface-400 bg-surface-900 border-surface-700'}">{exec.status}</span>
                </td>
                <td class="px-3 py-2 border-b border-surface-800 text-surface-400">{exec.triggered_by ?? "-"}</td>
                <td class="px-3 py-2 border-b border-surface-800 text-right text-xs text-surface-500 whitespace-nowrap">{fmtDate(exec.created_at)}</td>
              </tr>
              {#if open}
                <tr class="bg-surface-950">
                  <td colspan="4" class="px-3 pl-9 py-3 border-b border-surface-800">
                    {#if exec.parameters && Object.keys(exec.parameters).length > 0}
                      <pre class="text-xs text-surface-300 bg-surface-950 border border-surface-800 rounded px-3 py-2 overflow-x-auto mb-2">{JSON.stringify(exec.parameters, null, 2)}</pre>
                    {/if}
                    {#if exec.result}
                      <p class="text-sm {exec.status === 'failed' ? 'text-error-400' : 'text-surface-300'}">{exec.result}</p>
                    {/if}
                    <p class="text-xs text-surface-600 mt-2">{exec.run_date} · id {exec.id}</p>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  </main>
</div>
