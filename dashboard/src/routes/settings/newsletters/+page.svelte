<script lang="ts">
  import { enhance } from "$app/forms";
  import Page from "#lib/components/Page.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  $effect(() => toastFormResult(form));
</script>

<Page title="Newsletter sources" size="form" class="flex flex-col gap-6">
  <div>
    <h1 class="text-xl font-bold text-surface-50">Newsletter sources</h1>
    <p class="mt-1 text-xs text-surface-400">Changes take effect on the next pipeline run. A feed listed here takes precedence over its email copy.</p>
  </div>

  <section class="flex flex-col gap-3">
    <div>
      <h2 class="text-base font-semibold text-surface-100">RSS feeds <Badge tone="muted">{data.feeds.length}</Badge></h2>
      <p class="text-xs text-surface-400">A failed fetch appears below its link and in Notifications after the run.</p>
    </div>
    <form method="POST" action="?/createFeed" use:enhance class="rounded-lg border border-surface-700 bg-surface-900 p-4 flex flex-col sm:flex-row gap-2">
      <input name="sourceName" required maxlength="120" placeholder="Source name" aria-label="New feed source name" class="input-base-flush min-w-0 sm:w-1/3" />
      <input name="url" type="url" required placeholder="https://example.com/feed" aria-label="New feed URL" class="input-base-flush min-w-0 flex-1 font-mono" />
      <button class="tap rounded border border-primary-700 bg-primary-900 px-3 py-2 text-xs text-primary-200 cursor-pointer">Add feed</button>
    </form>
    <ul class="flex flex-col gap-3">
      {#each data.feeds as feed (feed.sourceName)}
        <li class="rounded-lg border border-surface-700 bg-surface-900 p-4">
          <div class="flex items-center justify-between gap-2">
            <strong class="text-sm text-surface-100">{feed.sourceName}</strong>
            {#if feed.lastError}<Badge tone="error">Fetch failed</Badge>{:else if feed.lastSuccessAt}<Badge tone="success">Fetched</Badge>{/if}
          </div>
          <a href={feed.url} target="_blank" rel="noopener noreferrer" class="mt-1 block break-all font-mono text-xs text-primary-300 hover:text-primary-200">{feed.url}</a>
          {#if feed.lastError}
            <p class="mt-2 text-xs text-error-400 break-words" role="alert">{feed.lastError}{feed.lastErrorAt ? ` · ${fmtDateTimeShort(feed.lastErrorAt)}` : ""}</p>
          {/if}
          <details class="mt-3 border-t border-surface-800 pt-2">
            <summary class="cursor-pointer text-xs text-surface-300">Edit or remove</summary>
            <form method="POST" action="?/updateFeed" use:enhance class="mt-3 flex flex-col gap-2">
              <input type="hidden" name="oldName" value={feed.sourceName} />
              <label class="text-xs text-surface-400">Source name<input name="sourceName" required maxlength="120" value={feed.sourceName} class="input-base-flush mt-1 w-full" /></label>
              <label class="text-xs text-surface-400">Feed URL<input name="url" type="url" required value={feed.url} class="input-base-flush mt-1 w-full font-mono" /></label>
              <button class="tap self-start rounded border border-primary-700 bg-primary-900 px-3 py-1.5 text-xs text-primary-200 cursor-pointer">Save feed</button>
            </form>
            <div class="mt-3"><ConfirmButton label="Remove feed" action="?/deleteFeed" fields={{ sourceName: feed.sourceName }} /></div>
          </details>
        </li>
      {/each}
    </ul>
  </section>

  <section class="flex flex-col gap-3">
    <div>
      <h2 class="text-base font-semibold text-surface-100">Email sender rules <Badge tone="muted">{data.rules.length}</Badge></h2>
      <p class="text-xs text-surface-400">Exact email addresses win over domains. A blank name on a domain rule uses the sender's display name.</p>
    </div>
    <form method="POST" action="?/createRule" use:enhance class="rounded-lg border border-surface-700 bg-surface-900 p-4 grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto] gap-2">
      <select name="matchKind" aria-label="New sender rule type" class="input-base-flush"><option value="domain">Domain</option><option value="address">Address</option></select>
      <input name="pattern" required placeholder="example.com" aria-label="New sender pattern" class="input-base-flush min-w-0 font-mono" />
      <input name="sourceName" maxlength="120" placeholder="Newsletter name" aria-label="New sender source name" class="input-base-flush min-w-0" />
      <button class="tap rounded border border-primary-700 bg-primary-900 px-3 py-2 text-xs text-primary-200 cursor-pointer">Add rule</button>
    </form>
    <ul class="flex flex-col gap-2">
      {#each data.rules as rule (rule.id)}
        <li class="rounded-lg border border-surface-700 bg-surface-900 p-3">
          <form method="POST" action="?/updateRule" use:enhance class="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_auto] gap-2 items-end">
            <input type="hidden" name="id" value={rule.id} />
            <label class="text-xs text-surface-400">Match<select name="matchKind" value={rule.matchKind} class="input-base-flush mt-1 w-full"><option value="domain">Domain</option><option value="address">Address</option></select></label>
            <label class="text-xs text-surface-400">Sender<input name="pattern" required value={rule.pattern} class="input-base-flush mt-1 w-full min-w-0 font-mono" /></label>
            <label class="text-xs text-surface-400">Source<input name="sourceName" maxlength="120" value={rule.sourceName} placeholder="Use display name" class="input-base-flush mt-1 w-full min-w-0" /></label>
            <button class="tap rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 cursor-pointer">Save</button>
          </form>
          <div class="mt-2"><ConfirmButton label="Remove rule" action="?/deleteRule" fields={{ id: rule.id }} /></div>
        </li>
      {/each}
    </ul>
  </section>
</Page>
