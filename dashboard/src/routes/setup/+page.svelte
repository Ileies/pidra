<script lang="ts">
  // `/setup`: first-passkey bootstrap and device/PIN/session management. WebAuthn registration and
  // PIN set call `/api/auth/*` through `netJson`; deleting a passkey or revoking a session are the
  // `deleteCredential`/`revokeSession` actions in `+page.server.ts` (which also explains the gating).
  import { jsonInit } from "#lib/http.js";
  import { errMessage } from "$pipeline/util/text";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { startRegistration } from "@simplewebauthn/browser";
  import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
  import { netJson } from "#lib/offline/net.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import Field from "#lib/components/Field.svelte";
  import { toastFormResult, toasts } from "#lib/toast.svelte.js";
  import { fmtDateTime } from "#lib/format.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  let registering = $state(false);
  let deviceLabel = $state("");
  let regError = $state<string | null>(null);

  let pin = $state("");
  let pinConfirm = $state("");
  let pinBusy = $state(false);
  let pinError = $state<string | null>(null);

  async function registerPasskey() {
    regError = null;
    registering = true;
    try {
      const { options, nonce } = await netJson<{ options: PublicKeyCredentialCreationOptionsJSON; nonce: string }>(
        "/api/auth/register/challenge",
        { method: "POST" },
      );
      const response: RegistrationResponseJSON = await startRegistration({ optionsJSON: options });
      await netJson("/api/auth/register/verify", jsonInit("POST", { nonce, response, deviceLabel: deviceLabel || undefined }));
      toasts.success("Passkey registered.");
      deviceLabel = "";
      await invalidateAll();
    } catch (err) {
      regError = errMessage(err);
    } finally {
      registering = false;
    }
  }

  async function submitPin(event: SubmitEvent) {
    event.preventDefault();
    pinError = null;
    if (pin !== pinConfirm) {
      pinError = "PINs don't match.";
      return;
    }
    pinBusy = true;
    try {
      await netJson("/api/auth/pin/set", jsonInit("POST", { pin }));
      toasts.success(data.pinSet ? "PIN changed." : "PIN set.");
      pin = "";
      pinConfirm = "";
      await invalidateAll();
    } catch (err) {
      pinError = errMessage(err);
    } finally {
      pinBusy = false;
    }
  }
</script>

<Page title="Passkey" size="app" class="flex flex-col gap-6">
  <h1 class="text-xl font-bold text-surface-50">Sign-in</h1>

  <div class="flex flex-1 flex-col gap-6 max-w-3xl mx-auto w-full">
    <p class="text-xs text-surface-400 max-w-prose">
      {#if data.bootstrapping}
        First-time setup: register a passkey (Bitwarden can hold it, so it syncs to every device),
        then set the PIN checked right after it.
      {:else}
        Every login is a passkey, then the PIN. Register another device's passkey here, or change
        the PIN.
      {/if}
    </p>

    <Card as="section" class="px-4 sm:px-5 py-4 flex flex-col gap-3">
      <h2 class="text-sm font-semibold text-surface-100">Passkeys</h2>
      {#if data.credentials.length === 0}
        <p class="text-xs text-surface-400">None registered yet.</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each data.credentials as cred (cred.id)}
            <li class="flex flex-wrap items-center gap-2 text-xs text-surface-300">
              <span>{cred.deviceLabel || "Passkey"}</span>
              {#if cred.createdAt}<span class="text-surface-500">added {fmtDateTime(cred.createdAt)}</span>{/if}
              {#if cred.lastUsedAt}<span class="text-surface-500">last used {fmtDateTime(cred.lastUsedAt)}</span>{/if}
              {#if data.credentials.length > 1 && !data.bootstrapping}
                <form
                  method="POST"
                  action="?/deleteCredential"
                  use:enhance
                  class="ml-auto"
                >
                  <input type="hidden" name="id" value={cred.id} />
                  <button type="submit" class="btn btn-quiet-danger btn-bare text-xs">Remove</button>
                </form>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <div class="flex flex-col gap-2 pt-1">
        <input
          bind:value={deviceLabel}
          placeholder="Label (e.g. Desktop Chrome)"
          class="input-base-flush w-full sm:w-72"
        />
        <button
          type="button"
          onclick={registerPasskey}
          disabled={registering}
          class="btn btn-md btn-primary self-start"
        >{registering ? "Waiting for passkey…" : "Register a passkey"}</button>
        {#if regError}<p class="text-xs text-error-400" role="alert">{regError}</p>{/if}
      </div>
    </Card>

    <Card as="section" class="px-4 sm:px-5 py-4 flex flex-col gap-3">
      <h2 class="text-sm font-semibold text-surface-100">PIN</h2>
      <p class="text-xs text-surface-400">6-10 digits. Checked only after a passkey already succeeded.</p>
      <form onsubmit={submitPin} class="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label={data.pinSet ? "New PIN" : "PIN"} dense type="password" inputmode="numeric" pattern="[0-9]*" maxlength="10" bind:value={pin} inputClass="sm:w-40" />
        <Field label="Confirm" dense type="password" inputmode="numeric" pattern="[0-9]*" maxlength="10" bind:value={pinConfirm} inputClass="sm:w-40" />
        <button
          type="submit"
          disabled={pinBusy || pin.length < 6}
          class="btn btn-md btn-primary"
        >{pinBusy ? "Saving…" : data.pinSet ? "Change PIN" : "Set PIN"}</button>
      </form>
      {#if pinError}<p class="text-xs text-error-400" role="alert">{pinError}</p>{/if}
    </Card>

    {#if !data.bootstrapping}
      <Card as="section" class="px-4 sm:px-5 py-4 flex flex-col gap-3">
        <h2 class="text-sm font-semibold text-surface-100">Active sessions</h2>
        {#if data.sessions.length === 0}
          <p class="text-xs text-surface-400">None.</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each data.sessions as sess (sess.id)}
              <li class="flex flex-wrap items-center gap-2 text-xs text-surface-300">
                <span class="truncate max-w-64" title={sess.userAgent || "Unknown device"}>{sess.userAgent || "Unknown device"}</span>
                {#if sess.lastSeenAt}<span class="text-surface-500">seen {fmtDateTime(sess.lastSeenAt)}</span>{/if}
                <Badge tone="muted">expires {fmtDateTime(sess.expiresAt)}</Badge>
                <form method="POST" action="?/revokeSession" use:enhance class="ml-auto">
                  <input type="hidden" name="id" value={sess.id} />
                  <button type="submit" class="btn btn-quiet-danger btn-bare text-xs">Sign out</button>
                </form>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
    {/if}

    {#if data.bootstrapping && data.credentials.length > 0 && data.pinSet}
      <a href="/login" class="btn btn-lg btn-primary self-start">
        Done - go to login
      </a>
    {/if}
  </div>
</Page>
