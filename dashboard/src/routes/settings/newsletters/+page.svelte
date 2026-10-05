<script lang="ts">
  // `/settings/newsletters` (online-only): live RSS feed cards, add/edit in one Sheet. Data and the
  // `createFeed`/`updateFeed`/`deleteFeed` actions are in `+page.server.ts` (`$lib/server/newsletters.ts`).
  // Sender rules are the child page `rules/`.
  import { enhance } from "$app/forms";
  import Page from "#lib/components/Page.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import Field from "#lib/components/Field.svelte";
  import Sheet from "#lib/components/Sheet.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  $effect(() => toastFormResult(form));

  // Writable derived: follows `data.feeds` after every reload, but a freshly created feed is
  // added locally the moment the server confirms it instead of waiting for the reload.
  let feeds = $derived(data.feeds);
  let editingFeed = $state<PageData["feeds"][number] | null>(null);
  let submitting = $state(false);
  let adding = $state(false);

  function closeFeedModal() {
    editingFeed = null;
  }

</script>

<Page title="Newsletter sources" size="app" class="flex flex-col gap-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-bold text-surface-50">Newsletter sources <Badge tone="muted">{feeds.length}</Badge></h1>
      <p class="text-xs text-surface-400 max-w-prose">
        Changes take effect on the next pipeline run. A feed listed here takes precedence over its
        email copy, and a failed fetch appears below its link and in the run's issues on Runs.
      </p>
    </div>
    <a href="/settings/newsletters/rules" class="tap shrink-0 text-xs text-surface-400 hover:text-primary-300">Email sender rules &rarr;</a>
  </div>

  <form
    method="POST"
    action="?/createFeed"
    use:enhance={() => {
      adding = true;
      return async ({ update, result }) => {
        try {
          if (result.type === "success" && result.data?.feed) {
            const created = result.data.feed as PageData["feeds"][number];
            feeds = [...feeds.filter((f) => f.sourceName !== created.sourceName), created].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
          }
          await update();
        } finally {
          adding = false;
        }
      };
    }}
    class="rounded-lg border border-surface-700 bg-surface-900 p-4 flex flex-col sm:flex-row gap-2"
  >
    <input name="sourceName" required maxlength="120" placeholder="Source name" aria-label="New feed source name" class="input-base-flush min-w-0 sm:w-1/3" />
    <input name="url" type="url" required placeholder="https://example.com/feed" aria-label="New feed URL" class="input-base-flush min-w-0 flex-1 font-mono" />
    <button disabled={adding} class="btn btn-sm btn-primary">{adding ? "Adding…" : "Add feed"}</button>
  </form>
  <!-- A grid, not a single stretched column : these cards are short, so one column at
       `app` width left most of the row empty. -->
  <ul class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 items-start gap-3">
    {#each feeds as feed (feed.sourceName)}
      <Card as="li" class="p-4">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <strong class="text-sm text-surface-100">{feed.sourceName}</strong>
            {#if feed.lastError}<Badge tone="error">Fetch failed</Badge>{:else if feed.lastSuccessAt}<Badge tone="success">Fetched</Badge>{/if}
          </div>
          <button type="button" onclick={() => (editingFeed = feed)} class="btn btn-sm btn-ghost shrink-0">Edit</button>
        </div>
        <a href={feed.url} target="_blank" rel="noopener noreferrer" class="mt-1 block break-all font-mono text-xs text-primary-300 hover:text-primary-200">{feed.url}</a>
        {#if feed.lastError}
          <p class="mt-2 text-xs text-error-400 break-words" role="alert">{feed.lastError}{feed.lastErrorAt ? ` · ${fmtDateTimeShort(feed.lastErrorAt)}` : ""}</p>
        {/if}
      </Card>
    {/each}
  </ul>
</Page>

<Sheet open={editingFeed !== null} title={editingFeed ? `Edit ${editingFeed.sourceName}` : "Edit feed"} onclose={closeFeedModal}>
  {#if editingFeed}
    <form
      id="feed-form"
      method="POST"
      action="?/updateFeed"
      class="flex flex-col gap-3"
      use:enhance={() => {
        submitting = true;
        return async ({ update, result }) => {
          try {
            if (result.type === "success") closeFeedModal();
            await update();
          } finally {
            submitting = false;
          }
        };
      }}
    >
      <input type="hidden" name="oldName" value={editingFeed.sourceName} />
      <Field name="sourceName" label="Source name" dense required maxlength="120" value={editingFeed.sourceName} />
      <Field name="url" label="Feed URL" dense mono type="url" required value={editingFeed.url} />
    </form>
  {/if}

  {#snippet footer()}
    {#if editingFeed}
      <div class="flex items-center justify-between gap-3">
        <ConfirmButton label="Remove feed" action="?/deleteFeed" fields={{ sourceName: editingFeed.sourceName }} onSuccess={closeFeedModal} />
        <div class="flex gap-2">
          <button type="button" onclick={closeFeedModal} class="btn btn-sm btn-solid">Cancel</button>
          <button type="submit" form="feed-form" disabled={submitting} class="btn btn-sm btn-primary">{submitting ? "Saving…" : "Save feed"}</button>
        </div>
      </div>
    {/if}
  {/snippet}
</Sheet>
