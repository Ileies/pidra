<script lang="ts">
  import { jsonInit } from "#lib/http.js";
  import { errMessage } from "$pipeline/util/text";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { startAuthentication } from "@simplewebauthn/browser";
  import type { PublicKeyCredentialRequestOptionsJSON, AuthenticationResponseJSON } from "@simplewebauthn/browser";
  import { netJson } from "#lib/offline/net.js";
  import Page from "#lib/components/Page.svelte";
  import Card from "#lib/components/Card.svelte";

  type Step = "passkey" | "pin";

  let step = $state<Step>("passkey");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let pin = $state("");

  const redirectTo = $derived(page.url.searchParams.get("redirect") || "/");

  async function signInWithPasskey() {
    error = null;
    busy = true;
    try {
      const { options, nonce } = await netJson<{ options: PublicKeyCredentialRequestOptionsJSON; nonce: string }>(
        "/api/auth/webauthn/challenge",
        { method: "POST" },
      );
      const response: AuthenticationResponseJSON = await startAuthentication({ optionsJSON: options });
      await netJson("/api/auth/webauthn/verify", jsonInit("POST", { nonce, response }));
      step = "pin";
    } catch (err) {
      error = errMessage(err);
    } finally {
      busy = false;
    }
  }

  async function submitPin(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    busy = true;
    try {
      await netJson("/api/auth/pin/verify", jsonInit("POST", { pin }));
      await goto(redirectTo, { invalidateAll: true });
    } catch (err) {
      error = errMessage(err);
      pin = "";
    } finally {
      busy = false;
    }
  }
</script>

<Page title="Log in" size="form" class="flex flex-col items-center justify-center gap-6 min-h-[70dvh]">
  <Card class="w-full max-w-sm flex flex-col gap-5 px-6 py-8">
    <div class="flex flex-col gap-1 text-center">
      <h1 class="text-xl font-bold text-surface-50">PIDRA</h1>
      <p class="text-xs text-surface-400">
        {step === "passkey" ? "Sign in with your passkey." : "Enter your PIN."}
      </p>
    </div>

    {#if error}
      <p class="text-sm text-error-400 text-center" role="alert">{error}</p>
    {/if}

    {#if step === "passkey"}
      <button
        type="button"
        onclick={signInWithPasskey}
        disabled={busy}
        class="btn btn-lg btn-primary w-full font-medium"
      >{busy ? "Waiting for passkey…" : "Sign in with passkey"}</button>
    {:else}
      <form onsubmit={submitPin} class="flex flex-col gap-3">
        <input
          type="password"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]*"
          maxlength="10"
          bind:value={pin}
          placeholder="PIN"
          class="input-base-flush w-full text-center text-lg tracking-widest"
        />
        <button
          type="submit"
          disabled={busy || pin.length < 6}
          class="btn btn-lg btn-primary w-full font-medium"
        >{busy ? "Checking…" : "Continue"}</button>
      </form>
    {/if}
  </Card>
  <nav aria-label="Legal" class="flex items-center gap-4 text-xs text-surface-400">
    <a href="/privacy" class="underline hover:text-surface-200">Privacy policy</a>
    <a href="/terms" class="underline hover:text-surface-200">Terms of service</a>
  </nav>
</Page>
