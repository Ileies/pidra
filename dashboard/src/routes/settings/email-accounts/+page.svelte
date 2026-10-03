<script lang="ts">
  import { enhance } from "$app/forms";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Server from "@lucide/svelte/icons/server";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Sheet from "#lib/components/Sheet.svelte";
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

  /** One sheet serves both "Add account" and editing a card - `null` when closed. */
  let target = $state<EmailAccountRow | "new" | null>(null);
  const editTarget = $derived(target === "new" ? undefined : (target ?? undefined));

  // A slow or flaky connection invited repeat clicks on Save (a prod report, 2026-09-29), and
  // every one of them ran its own `update()` with its own toast and `invalidateAll()`.
  let submitting = $state(false);

  // The sheet is a native modal `<dialog>` in the top layer, which covers the toast, so a failed
  // save is shown inside the sheet and the sheet stays open with the typed values intact.
  let formError = $state<string | null>(null);

  function openSheet(next: EmailAccountRow | "new") {
    formError = null;
    target = next;
  }

  function closeSheet() {
    target = null;
  }

  /** The settings that differ from the defaults, as label/value pairs for a card. */
  function details(a: EmailAccountRow): [string, string][] {
    const rows: [string, string][] = [];
    if (a.folder !== "INBOX") rows.push(["Folder", a.folder]);
    if (a.aliases?.length) rows.push(["Aliases", a.aliases.join(", ")]);
    if (a.ignore?.length) rows.push(["Ignores", a.ignore.join(", ")]);
    if (a.smtpHost) rows.push(["SMTP", `${a.smtpHost}${a.smtpPort ? `:${a.smtpPort}` : ""}${a.smtpSecure ? " (TLS)" : ""}`]);
    return rows;
  }

  const LABEL = "flex flex-col gap-1.5 text-sm text-surface-300";
  const HINT = "text-xs text-surface-500";
  const MONO = "font-mono";
</script>

{#snippet fields(a?: EmailAccountRow)}
  <div class="flex flex-col gap-6">
    <fieldset class="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
      <legend class="mb-3 p-0 text-xs font-semibold uppercase tracking-wide text-surface-400">Account</legend>
      <label class={LABEL}>
        Label
        <input name="label" required value={a?.label ?? ""} placeholder="Newsletter Inbox" autocomplete="off" class="input-base-flush w-full" />
      </label>
      <label class={LABEL}>
        IMAP host
        <input name="host" required value={a?.host ?? ""} placeholder="imap.example.com" autocomplete="off" autocapitalize="none" spellcheck="false" class="input-base-flush w-full {MONO}" />
      </label>
      <label class={LABEL}>
        User
        <input name="user" required value={a?.user ?? ""} placeholder="you@example.com" autocomplete="off" autocapitalize="none" spellcheck="false" class="input-base-flush w-full {MONO}" />
      </label>
      <label class={LABEL}>
        Password
        <input type="password" name="password" autocomplete="new-password" required={!a} class="input-base-flush w-full {MONO}" />
        {#if a}<span class={HINT}>Leave blank to keep the current one.</span>{/if}
      </label>
      <label class={LABEL}>
        Folder
        <input name="folder" value={a?.folder ?? "INBOX"} placeholder="INBOX" autocomplete="off" autocapitalize="none" spellcheck="false" class="input-base-flush w-full {MONO}" />
      </label>
      <label class="tap-check text-sm text-surface-200">
        <input type="checkbox" name="isNewsAccount" checked={a?.isNewsAccount ?? false} class="h-5 w-5 shrink-0 accent-primary-500" />
        <span>Newsletter account <span class={HINT}>(skips personal classification)</span></span>
      </label>
    </fieldset>

    <fieldset class="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
      <legend class="mb-3 p-0 text-xs font-semibold uppercase tracking-wide text-surface-400">Mail handling</legend>
      <label class={LABEL}>
        Aliases
        <input name="aliases" value={a?.aliases?.join(", ") ?? ""} placeholder="admin@example.com, you@example.com" autocomplete="off" autocapitalize="none" spellcheck="false" class="input-base-flush w-full {MONO}" />
        <span class={HINT}>Comma-separated.</span>
      </label>
      <label class={LABEL}>
        Ignored senders
        <input name="ignore" value={a?.ignore?.join(", ") ?? ""} placeholder="newsletter@example.com" autocomplete="off" autocapitalize="none" spellcheck="false" class="input-base-flush w-full {MONO}" />
        <span class={HINT}>Comma-separated.</span>
      </label>
      <label class={LABEL}>
        Custom instructions
        <textarea name="customInstructions" rows="3" placeholder="How extraction should treat mail from this account" class="input-base-flush w-full resize-y">{a?.customInstructions ?? ""}</textarea>
      </label>
    </fieldset>

    <fieldset class="flex flex-col gap-3 border-0 p-0 m-0 min-w-0">
      <legend class="mb-3 p-0 text-xs font-semibold uppercase tracking-wide text-surface-400">Sending (SMTP)</legend>
      <label class={LABEL}>
        SMTP host override
        <input name="smtpHost" value={a?.smtpHost ?? ""} placeholder="Derived from the IMAP host when empty" autocomplete="off" autocapitalize="none" spellcheck="false" class="input-base-flush w-full {MONO}" />
      </label>
      <div class="flex items-end gap-4">
        <label class="{LABEL} flex-1">
          SMTP port
          <input type="number" inputmode="numeric" name="smtpPort" min="1" max="65535" value={a?.smtpPort ?? ""} placeholder="587" class="input-base-flush w-full {MONO}" />
        </label>
        <label class="tap-check text-sm text-surface-200 pb-0.5">
          <input type="checkbox" name="smtpSecure" checked={a?.smtpSecure ?? false} class="h-5 w-5 shrink-0 accent-primary-500" />
          TLS
        </label>
      </div>
    </fieldset>
  </div>
{/snippet}

<Page title="Email accounts" size="app" class="flex flex-col gap-5">
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <h1 class="flex min-w-0 items-center gap-2 text-xl font-bold text-surface-50">
        Email accounts <Badge tone="muted">{data.accounts.length}</Badge>
      </h1>
      <button
        type="button"
        onclick={() => openSheet("new")}
        class="tap inline-flex shrink-0 items-center justify-center gap-1.5 rounded border border-primary-700 bg-primary-900 px-3 py-1.5 text-sm text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors"
      ><Plus class="h-4 w-4" aria-hidden="true" />Add account</button>
    </div>
    <p class="text-xs text-surface-400 max-w-prose">
      IMAP/SMTP accounts the daily pipeline and the Context Builder read from. A saved password is
      never shown again.
    </p>
  </div>

  {#if data.accounts.length === 0}
    <EmptyState title="No email accounts configured." hint="Add one - the pipeline has nothing to ingest until it does." />
  {:else}
    <ul class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 items-start gap-3">
      {#each data.accounts as account (account.id)}
        {@const rows = details(account)}
        <li class="flex flex-col gap-3 rounded-lg border border-surface-700 bg-surface-900 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong class="break-words text-base text-surface-100">{account.label}</strong>
                {#if account.isNewsAccount}<Badge tone="muted">Newsletter</Badge>{/if}
              </div>
              <span class="break-all font-mono text-xs text-surface-300">{account.user}</span>
              <span class="flex items-center gap-1.5 text-xs text-surface-400">
                <Server class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span class="break-all font-mono">{account.host}</span>
              </span>
            </div>
            <button
              type="button"
              onclick={() => openSheet(account)}
              aria-label="Edit {account.label}"
              class="tap inline-flex shrink-0 items-center justify-center gap-1.5 rounded border border-surface-600 px-3 py-1.5 text-xs text-surface-200 hover:bg-surface-800 cursor-pointer transition-colors"
            ><Pencil class="h-3.5 w-3.5" aria-hidden="true" />Edit</button>
          </div>

          {#if rows.length || account.customInstructions}
            <div class="flex flex-col gap-2 border-t border-surface-800 pt-3 text-xs">
              {#if rows.length}
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  {#each rows as [name, value] (name)}
                    <dt class="text-surface-500">{name}</dt>
                    <dd class="m-0 break-words font-mono text-surface-300">{value}</dd>
                  {/each}
                </dl>
              {/if}
              {#if account.customInstructions}
                <p class="m-0 line-clamp-3 whitespace-pre-wrap break-words text-surface-400">{account.customInstructions}</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Page>

<Sheet open={target !== null} title={editTarget ? editTarget.label : "Add account"} onclose={closeSheet}>
  {#if target !== null}
    {#key editTarget?.id ?? "new"}
      <form
        id="account-form"
        method="POST"
        action={editTarget ? "?/update" : "?/create"}
        use:enhance={() => {
          submitting = true;
          formError = null;
          return async ({ update, result }) => {
            try {
              if (result.type === "success") closeSheet();
              else if (result.type === "failure") formError = (result.data?.error as string | undefined) ?? "Could not save the account.";
              await update();
            } finally {
              submitting = false;
            }
          };
        }}
      >
        {#if editTarget}<input type="hidden" name="id" value={editTarget.id} />{/if}
        {@render fields(editTarget)}
      </form>

      {#if editTarget}
        <div class="mt-6 flex flex-col gap-2 border-t border-surface-800 pt-4">
          <span class="text-xs font-semibold uppercase tracking-wide text-surface-400">Remove account</span>
          <p class="m-0 text-xs text-surface-500">The pipeline stops reading this mailbox.</p>
          <div class="flex"><ConfirmButton label="Delete account" action="?/delete" fields={{ id: editTarget.id }} onSuccess={closeSheet} /></div>
        </div>
      {/if}
    {/key}
  {/if}

  {#snippet footer()}
    <div class="flex flex-col gap-3">
      {#if formError}
        <p class="m-0 break-words rounded border border-error-800 bg-error-950 px-3 py-2 text-sm text-error-400" role="alert">{formError}</p>
      {/if}
      <div class="flex gap-2 sm:justify-end">
        <button
          type="button"
          onclick={closeSheet}
          class="tap flex-1 rounded border border-surface-500 bg-surface-800 px-4 py-1.5 text-sm text-surface-200 hover:bg-surface-700 cursor-pointer sm:flex-none"
        >Cancel</button>
        <button
          type="submit"
          form="account-form"
          disabled={submitting}
          class="tap flex-1 rounded border border-primary-700 bg-primary-900 px-4 py-1.5 text-sm text-primary-200 hover:bg-primary-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed sm:flex-none"
        >{submitting ? "Saving…" : editTarget ? "Save" : "Add account"}</button>
      </div>
    </div>
  {/snippet}
</Sheet>
