<script lang="ts">
  /**
   * The skill registry and the execution log.
   *
   * Skills are code-defined and not editable from here - the registry is a read-only catalog plus
   * one switch per skill for turning it off. No expand, no form: flipping the switch submits
   * immediately.
   */
  import { enhance } from "$app/forms";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
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

  let searchQuery = $state("");

  let filteredSkills = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.skills
      .filter((skill) => !q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
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

      <input
        type="search"
        placeholder="Search skills…"
        aria-label="Search skills"
        bind:value={searchQuery}
        class="input-base flex-1 sm:w-48 sm:flex-none"
      />
    </div>

    {#if filteredSkills.length === 0}
      <EmptyState title="No skills match." compact />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each filteredSkills as skill (skill.name)}
          <li class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-3 flex items-center gap-3 {skill.enabled ? '' : 'opacity-60'}">
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <span class="flex items-center gap-2 flex-wrap">
                <span class="font-mono text-surface-100 text-sm break-all">{skill.name}</span>
                <!-- The risk level was a 6px coloured dot with a title=. On a touch device that
                     is nothing at all (P7, M13), so it is a word with a hue behind it. -->
                <Badge tone={RISK_TONE[skill.risk_level] ?? "muted"}>{skill.risk_level}</Badge>
              </span>
              <span class="text-sm text-surface-300">{skill.description}</span>
            </div>

            <form method="POST" action="?/update" use:enhance class="shrink-0">
              <input type="hidden" name="skillName" value={skill.name} />
              <label
                class="tap relative inline-flex items-center cursor-pointer"
                title={skill.enabled ? "Enabled - click to disable" : "Disabled - click to enable"}
              >
                <input
                  type="checkbox"
                  name="enabled"
                  value="true"
                  checked={skill.enabled}
                  onchange={(e) => e.currentTarget.form?.requestSubmit()}
                  class="sr-only peer"
                  aria-label="{skill.enabled ? 'Disable' : 'Enable'} {skill.name}"
                />
                <span class="block w-10 h-5 rounded-full bg-surface-700 peer-checked:bg-success-700 transition-colors"></span>
                <span class="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-surface-200 transition-transform peer-checked:translate-x-5"></span>
              </label>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <a href="/skills/executions" class="tap self-start text-sm text-primary-400 hover:text-primary-300">Recent executions →</a>
</Page>
