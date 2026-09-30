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

  /** One modal serves both "+ New account" and editing a row - `null` when closed. */
  let modalAccount = $state<EmailAccountRow | "new" | null>(null);
  const modalMode = $derived(modalAccount === "new" ? "new" : modalAccount ? "edit" : null);

  // Nothing disabled the Save button while a submit was in flight, and closing/re-showing the
  // modal happened only after the response came back - so a slow or flaky connection (a prod
  // report, 2026-09-29) invited repeat clicks, and every one of them ran its own `update()`, each
  // producing its own toast and its own `invalidateAll()`.
  let submitting = $state(false);

  function closeModal() {
    modalAccount = null;
  }

  // Deleting happens through its own form inside the modal (ConfirmButton), so there is no
  // shared submit handler to hook a close into - once the deleted row drops out of `data.accounts`
  // after the reload, the modal editing it no longer has anything to show and closes itself.
  $effect(() => {
    if (modalAccount !== "new" && modalAccount !== null && !data.accounts.some((a) => a.id === (modalAccount as EmailAccountRow).id)) {
      modalAccount = null;
    }
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && modalAccount !== null) closeModal();
  }

  /** Everything that doesn't fit a column - behind the row's "Details" disclosure. */
  function rowDetails(a: EmailAccountRow): string {
    const parts = [];
    if (a.folder !== "INBOX") parts.push(`folder ${a.folder}`);
    if (a.aliases?.length) parts.push(`aliases ${a.aliases.join(", ")}`);
    if (a.ignore?.length) parts.push(`ignores ${a.ignore.join(", ")}`);
    if (a.smtpHost) parts.push(`smtp ${a.smtpHost}${a.smtpPort ? `:${a.smtpPort}` : ""}`);
    return parts.join(" · ");
  }
</script>

<svelte:window onkeydown={onKeydown} />

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

<Page title="Email accounts" size="app" class="flex flex-col gap-6">
  <div class="flex items-start justify-between gap-3">
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-bold text-surface-50">Email accounts</h1>
      <p class="text-xs text-surface-400 max-w-prose">
        IMAP/SMTP accounts the daily pipeline and the Context Builder read from. A saved password is
        never shown again - leave it blank on edit to keep the current one.
      </p>
    </div>
    <button
      type="button"
      onclick={() => (modalAccount = "new")}
      class="tap shrink-0 px-3 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors"
    >+ New</button>
  </div>

  {#if data.accounts.length === 0}
    <EmptyState title="No email accounts configured." hint="Add one above - the pipeline has nothing to ingest until it does." />
  {:else}
    <div class="overflow-x-auto rounded-lg border border-surface-700">
      <table class="w-full border-collapse text-left text-sm">
        <thead>
          <tr class="bg-surface-900 text-xs text-surface-400">
            <th class="px-4 py-2 font-medium">Label</th>
            <th class="px-4 py-2 font-medium">Account</th>
            <th class="px-4 py-2 font-medium">Host</th>
            <th class="px-4 py-2 font-medium">Details</th>
            <th class="px-4 py-2 font-medium"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.accounts as account (account.id)}
            <tr class="border-t border-surface-800 bg-surface-900 align-top hover:bg-surface-800/40">
              <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-surface-100">{account.label}</span>
                  {#if account.isNewsAccount}<Badge tone="muted">Newsletter</Badge>{/if}
                </div>
              </td>
              <td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-surface-300">{account.user}</td>
              <td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-surface-400">{account.host}</td>
              <td class="px-4 py-3 text-xs text-surface-500">
                {#if rowDetails(account) || account.customInstructions}
                  <details>
                    <summary class="w-fit cursor-pointer select-none text-surface-400 hover:text-surface-200">Details</summary>
                    <div class="mt-1.5 flex max-w-sm flex-col gap-1">
                      {#if rowDetails(account)}<span>{rowDetails(account)}</span>{/if}
                      {#if account.customInstructions}
                        <span class="whitespace-pre-wrap break-words">{account.customInstructions}</span>
                      {/if}
                    </div>
                  </details>
                {/if}
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  type="button"
                  onclick={() => (modalAccount = account)}
                  class="tap shrink-0 rounded border border-surface-600 px-3 py-1.5 text-xs text-surface-200 hover:bg-surface-800 cursor-pointer transition-colors"
                >Edit</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Page>

{#if modalMode}
  {@const editTarget = modalAccount === "new" ? undefined : (modalAccount as EmailAccountRow)}
  <div class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6dvh] sm:pt-[10dvh]">
    <button type="button" aria-label="Close" class="absolute inset-0 bg-surface-950/80 cursor-default" onclick={closeModal}></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalMode === "new" ? "Add email account" : "Edit email account"}
      class="relative w-full max-w-xl max-h-[88dvh] rounded-lg border border-surface-600 bg-surface-900 shadow-2xl overflow-hidden flex flex-col"
    >
      <div class="flex items-center justify-between gap-3 border-b border-surface-700 px-4 sm:px-5 py-3 shrink-0">
        <h2 class="text-sm font-semibold text-surface-100">{modalMode === "new" ? "Add account" : editTarget?.label}</h2>
        <button
          type="button"
          onclick={closeModal}
          aria-label="Close"
          class="tap text-surface-400 hover:text-surface-200 cursor-pointer bg-transparent border-none px-1"
        >✕</button>
      </div>

      <!-- `contents` so the fields div becomes the flex child that scrolls; the delete form below
           must be a sibling rather than nested inside this one, so the submit button targets this
           form's id by attribute instead of by DOM nesting. -->
      <form
        id="account-form"
        method="POST"
        action={modalMode === "new" ? "?/create" : "?/update"}
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            try {
              closeModal();
              await update();
            } finally {
              submitting = false;
            }
          };
        }}
        class="contents"
      >
        {#if editTarget}<input type="hidden" name="id" value={editTarget.id} />{/if}

        <div class="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          {@render fields(editTarget)}
        </div>
      </form>

      <div class="flex items-center justify-between gap-3 border-t border-surface-700 px-4 sm:px-5 py-3 shrink-0">
        {#if editTarget}
          <ConfirmButton label="Delete" action="?/delete" fields={{ id: editTarget.id }} />
        {:else}
          <span></span>
        {/if}
        <div class="flex gap-2">
          <button
            type="button"
            onclick={closeModal}
            class="tap px-3 py-1.5 rounded text-xs bg-surface-800 border border-surface-500 text-surface-200 hover:bg-surface-700 cursor-pointer"
          >Cancel</button>
          <button
            type="submit"
            form="account-form"
            disabled={submitting}
            class="tap px-4 py-1.5 rounded text-xs bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >{submitting ? "Saving…" : modalMode === "new" ? "Add account" : "Save"}</button>
        </div>
      </div>
    </div>
  </div>
{/if}
