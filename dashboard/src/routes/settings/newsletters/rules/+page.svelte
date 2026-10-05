<script lang="ts">
  // `/settings/newsletters/rules` (online-only): sender rules, one `SenderRuleRow` each. Actions
  // `createRule`/`updateRule`/`deleteRule` live in `+page.server.ts`.
  import { enhance } from "$app/forms";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import SenderRuleRow from "#lib/components/newsletters/SenderRuleRow.svelte";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  $effect(() => toastFormResult(form));
</script>

<Page title="Email sender rules" size="app" class="flex flex-col gap-6">
  <div class="flex items-center gap-3">
    <a href="/settings/newsletters" class="tap text-xs text-surface-400 hover:text-primary-300">&larr; Newsletter sources</a>
  </div>

  <div>
    <h1 class="text-xl font-bold text-surface-50">Email sender rules <Badge tone="muted">{data.rules.length}</Badge></h1>
    <p class="mt-1 text-xs text-surface-400">Exact email addresses win over domains. A blank name on a domain rule uses the sender's display name.</p>
  </div>

  <form method="POST" action="?/createRule" use:enhance class="rounded-lg border border-surface-700 bg-surface-900 p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto] gap-3">
    <select name="matchKind" aria-label="New sender rule type" class="input-base-flush"><option value="domain">Domain</option><option value="address">Address</option></select>
    <input name="pattern" required placeholder="example.com" aria-label="New sender pattern" class="input-base-flush min-w-0 font-mono" />
    <input name="sourceName" maxlength="120" placeholder="Newsletter name" aria-label="New sender source name" class="input-base-flush min-w-0" />
    <button class="btn btn-sm btn-primary">Add rule</button>
  </form>

  {#if data.rules.length === 0}
    <EmptyState title="No sender rules yet." hint="A rule here routes a sender to a newsletter source before extraction runs." />
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.rules as rule (rule.id)}
        <SenderRuleRow {rule} />
      {/each}
    </ul>
  {/if}
</Page>
