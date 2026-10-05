<script lang="ts">
  /**
   * `/skills` (online-only): the pending high-risk approval queue (`?/resolve`, runs via the bridge)
   * above the registry. Skills are code-defined; the registry is read-only apart from one enable
   * switch per skill (`?/update`, submits on flip). Data from `+page.server.ts`, which falls back to
   * `catalog.ts` when the bridge is down. Recent history is `/skills/executions`.
   */
  import { enhance } from "$app/forms";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import Switch from "#lib/components/Switch.svelte";
  import JsonBlock from "#lib/components/JsonBlock.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  const RISK_TONE = {
    low: "success",
    medium: "warning",
    high: "error",
    critical: "error",
  } as const;

  const RISK_RANK = { critical: 3, high: 2, medium: 1, low: 0 } as const;

  type SortKey = "usage" | "name" | "risk";

  let searchQuery = $state("");
  let sortKey = $state<SortKey>("name");

  let filteredSkills = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.skills
      .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
      .sort((a, b) => {
        if (sortKey === "usage" && a.uses !== b.uses) return b.uses - a.uses;
        if (sortKey === "risk" && a.risk_level !== b.risk_level) return RISK_RANK[b.risk_level] - RISK_RANK[a.risk_level];
        return a.name.localeCompare(b.name);
      });
  });
</script>

<Page title="Skills" size="app" class="flex flex-col gap-8">
  <!-- Approval queue: a high-risk call is inserted as `pending` and waits for the owner. It leads
       the page because it is the one thing here that blocks. -->
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
              <JsonBlock value={execution.parameters} />
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
                  class="btn btn-md flex-1 border-success-600 bg-success-800 text-success-100 hover:bg-success-700"
                >Confirm and run</button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  class="btn btn-md btn-danger flex-1"
                >Reject</button>
              </div>
            </form>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-surface-300">
        {data.skills.length} skills{#if filteredSkills.length !== data.skills.length}
          <span class="text-surface-400">({filteredSkills.length} shown)</span>{/if}
      </p>
      <div class="flex flex-wrap items-center gap-2 flex-1 sm:flex-none justify-end">
        <input
          type="search"
          placeholder="Search skills…"
          aria-label="Search skills"
          bind:value={searchQuery}
          class="input-base flex-1 sm:w-72 sm:flex-none"
        />
        <select bind:value={sortKey} aria-label="Sort skills" class="input-base">
          <option value="name">Alphabetical</option>
          <option value="usage">Most used (30 days)</option>
          <option value="risk">Risk level</option>
        </select>
      </div>
    </div>

    {#if filteredSkills.length === 0}
      <EmptyState title="No skills match." compact />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each filteredSkills as skill (skill.name)}
          <Card as="li" class="px-4 py-3 flex items-center gap-3 {skill.enabled ? '' : 'opacity-60'}">
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <span class="flex items-center gap-2 flex-wrap">
                <span class="font-mono text-surface-100 text-sm break-all">{skill.name}</span>
                <!-- The risk level was a 6px coloured dot with a title=. On a touch device that
                     is nothing at all (P7, M13), so it is a word with a hue behind it. -->
                <Badge tone={RISK_TONE[skill.risk_level] ?? "muted"}>{skill.risk_level}</Badge>
                <span class="text-xs text-surface-400">{skill.uses} {skill.uses === 1 ? "use" : "uses"} in 30 days</span>
              </span>
              <span class="text-sm text-surface-300">{skill.description}</span>
            </div>

            <form method="POST" action="?/update" use:enhance class="shrink-0">
              <input type="hidden" name="skillName" value={skill.name} />
              <Switch
                name="enabled"
                checked={skill.enabled}
                autosubmit
                label="{skill.enabled ? 'Disable' : 'Enable'} {skill.name}"
                title={skill.enabled ? "Enabled - click to disable" : "Disabled - click to enable"}
              />
            </form>
          </Card>
        {/each}
      </ul>
    {/if}
  </section>

  <a href="/skills/executions" class="tap self-start text-sm text-primary-400 hover:text-primary-300">Recent executions →</a>
</Page>
