<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { EmailAccountRow } from "#lib/server/emailAccounts.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  $effect(() => {
    setPageContext({
      surface: "global",
      route: "/settings/email-accounts",
      digest: `Email accounts: ${data.accounts.length} configured for the daily pipeline and the Context Builder.`,
      focus: focusFrom(data.accounts, "email_account", (a) => ({ id: a.id, label: `${a.label} (${a.user})` })),
    });
  });

  let adding = $state(false);
  let editing = $state<string | null>(null);

  function summary(a: EmailAccountRow): string {
    const parts = [a.host];
    if (a.folder !== "INBOX") parts.push(`folder ${a.folder}`);
    if (a.aliases?.length) parts.push(`aliases ${a.aliases.join(", ")}`);
    if (a.ignore?.length) parts.push(`ignores ${a.ignore.join(", ")}`);
    if (a.smtpHost) parts.push(`smtp ${a.smtpHost}${a.smtpPort ? `:${a.smtpPort}` : ""}`);
    return parts.join(" · ");
  }
</script>

{#snippet fields(a?: EmailAccountRow)}
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      Label
      <input name="label" required value={a?.label ?? ""} placeholder="Newsletter Inbox" class="input-base-flush" />
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      IMAP host
      <input name="host" required value={a?.host ?? ""} placeholder="imap.example.com" class="input-base-flush font-mono" />
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      User
      <input name="user" required value={a?.user ?? ""} placeholder="you@example.com" class="input-base-flush font-mono" />
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      Password {#if a}<span class="text-surface-500">(leave blank to keep the current one)</span>{/if}
      <input type="password" name="password" autocomplete="new-password" required={!a} class="input-base-flush font-mono" />
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      Folder
      <input name="folder" value={a?.folder ?? "INBOX"} placeholder="INBOX" class="input-base-flush font-mono" />
    </label>
    <label class="flex items-center gap-2 text-xs text-surface-400 sm:self-end sm:pb-2">
      <input type="checkbox" name="isNewsAccount" checked={a?.isNewsAccount ?? false} class="accent-primary-500" />
      Newsletter account (skips personal classification)
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400 sm:col-span-2">
      Custom instructions
      <textarea name="customInstructions" rows="3" placeholder="How extraction should treat mail from this account" class="input-base-flush resize-y"
        >{a?.customInstructions ?? ""}</textarea>
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      Aliases <span class="text-surface-500">(comma-separated)</span>
      <input name="aliases" value={a?.aliases?.join(", ") ?? ""} placeholder="admin@example.com, you@example.com" class="input-base-flush font-mono" />
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      Ignored senders <span class="text-surface-500">(comma-separated)</span>
      <input name="ignore" value={a?.ignore?.join(", ") ?? ""} placeholder="newsletter@example.com" class="input-base-flush font-mono" />
    </label>
    <label class="flex flex-col gap-1 text-xs text-surface-400">
      SMTP host override
      <input name="smtpHost" value={a?.smtpHost ?? ""} placeholder="derived from the IMAP host when empty" class="input-base-flush font-mono" />
    </label>
    <div class="flex gap-3">
      <label class="flex flex-col gap-1 text-xs text-surface-400 flex-1">
        SMTP port
        <input type="number" name="smtpPort" min="1" max="65535" value={a?.smtpPort ?? ""} placeholder="587" class="input-base-flush font-mono" />
      </label>
      <label class="flex items-center gap-2 text-xs text-surface-400 self-end pb-2">
        <input type="checkbox" name="smtpSecure" checked={a?.smtpSecure ?? false} class="accent-primary-500" />
        TLS
      </label>
    </div>
  </div>
{/snippet}

<Page title="Email accounts" size="form" class="flex flex-col gap-5">
  <div class="flex flex-col gap-1">
    <h1 class="text-xl font-bold text-surface-50">Email accounts</h1>
    <p class="text-xs text-surface-400 max-w-prose">
      IMAP/SMTP accounts the daily pipeline and the Context Builder read from. A saved password is
      never shown again - leave it blank on edit to keep the current one.
    </p>
  </div>

  <button
    onclick={() => (adding = !adding)}
    class="tap self-start px-3 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors"
  >{adding ? "Cancel" : "+ New account"}</button>

  {#if adding}
    <form
      method="POST"
      action="?/create"
      use:enhance={() => async ({ update }) => {
        adding = false;
        await update();
      }}
      class="bg-surface-900 border border-surface-700 rounded-lg px-4 sm:px-5 py-4 flex flex-col gap-3"
    >
      {@render fields()}
      <button
        type="submit"
        class="tap self-start px-4 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer"
      >Add account</button>
    </form>
  {/if}

  {#if data.accounts.length === 0}
    <EmptyState title="No email accounts configured." hint="Add one above - the pipeline has nothing to ingest until it does." />
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.accounts as account (account.id)}
        <li class="rounded-lg border border-surface-700 bg-surface-900 px-4 sm:px-5 py-4 flex flex-col gap-2">
          {#if editing === account.id}
            <form
              method="POST"
              action="?/update"
              use:enhance={() => async ({ update }) => {
                editing = null;
                await update();
              }}
              class="flex flex-col gap-3"
            >
              <input type="hidden" name="id" value={account.id} />
              {@render fields(account)}
              <div class="flex flex-wrap gap-2">
                <button
                  type="submit"
                  class="tap px-3 py-1 rounded text-xs bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer"
                >Save</button>
                <button
                  type="button"
                  onclick={() => (editing = null)}
                  class="tap px-3 py-1 rounded text-xs bg-surface-800 border border-surface-500 text-surface-200 hover:bg-surface-700 cursor-pointer"
                >Cancel</button>
              </div>
            </form>
          {:else}
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="flex flex-col gap-1">
                <button
                  onclick={() => (editing = account.id)}
                  class="text-left bg-transparent border-none p-0 text-sm font-medium text-surface-100 hover:text-primary-400 cursor-pointer transition-colors"
                  title="Click to edit"
                >{account.label}</button>
                <span class="text-xs text-surface-400 font-mono">{account.user}</span>
                <span class="text-xs text-surface-500">{summary(account)}</span>
                {#if account.customInstructions}
                  <span class="text-xs text-surface-500 whitespace-pre-wrap break-words max-w-prose">{account.customInstructions}</span>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                {#if account.isNewsAccount}
                  <Badge tone="muted">Newsletter</Badge>
                {/if}
                <ConfirmButton label="Delete" action="?/delete" fields={{ id: account.id }} />
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Page>
