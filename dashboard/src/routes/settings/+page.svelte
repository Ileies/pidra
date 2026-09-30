<script lang="ts">
  /**
   * The account-level page: notifications, the passkey/PIN manager, the legal pages, and log out.
   * These used to be individual controls on the navbar - one gear icon replaces five, and the
   * mobile tab bar gains a way to log out at all, which it never had.
   *
   * No data of its own: everything here is either a link to a page that already handles its own
   * state (`/setup`, `/privacy`, `/terms`) or a client-side control (`NotifyButton`, log out)
   * that talks to its endpoint directly. That is what keeps it mirrored rather than online-only.
   */
  import { goto } from "$app/navigation";
  import Page from "#lib/components/Page.svelte";
  import NotifyButton from "#lib/components/NotifyButton.svelte";
  import { netJson } from "#lib/offline/net.js";
  import { offline } from "#lib/offline/state.svelte.js";

  const isOffline = $derived(offline.reachable === "offline");
  let loggingOut = $state(false);

  // Not queued, same as the other actions that touch live server state while offline (contact
  // edits, topic curation): logging out is disabled with the reason rather than attempted, since
  // there is no way to know locally whether the server actually forgot the session.
  async function logOut() {
    if (isOffline) return;
    loggingOut = true;
    try {
      await netJson("/api/auth/logout", { method: "POST" });
    } finally {
      await goto("/login", { invalidateAll: true });
    }
  }
</script>

<Page title="Settings" size="form" class="flex flex-col gap-6">
  <h1 class="text-xl font-bold text-surface-50">Settings</h1>

  <section class="rounded-lg border border-surface-700 bg-surface-900 px-4 sm:px-5 py-4 flex flex-col gap-3">
    <h2 class="text-sm font-semibold text-surface-100">Notifications</h2>
    <p class="text-xs text-surface-400">Push a notification to this device when the morning briefing is ready.</p>
    <NotifyButton variant="row" />
  </section>

  <section class="rounded-lg border border-surface-700 bg-surface-900 px-4 sm:px-5 py-4 flex flex-col gap-3">
    <h2 class="text-sm font-semibold text-surface-100">Account</h2>
    <a
      href="/setup"
      class="tap flex items-center justify-between gap-3 rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 no-underline text-sm text-surface-200 hover:bg-surface-800"
    >
      <span>Passkey and PIN</span>
      <span class="text-xs text-surface-400">Register a device, change the PIN</span>
    </a>
    <a
      href="/settings/email-accounts"
      class="tap flex items-center justify-between gap-3 rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 no-underline text-sm text-surface-200 hover:bg-surface-800"
    >
      <span>Email accounts</span>
      <span class="text-xs text-surface-400">IMAP/SMTP accounts the pipeline reads</span>
    </a>
    <a
      href="/settings/newsletters"
      class="tap flex items-center justify-between gap-3 rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 no-underline text-sm text-surface-200 hover:bg-surface-800"
    >
      <span>Newsletter sources</span>
      <span class="text-xs text-surface-400">RSS feeds, errors, and email sender rules</span>
    </a>
    <button
      type="button"
      onclick={logOut}
      disabled={loggingOut || isOffline}
      title={isOffline ? "Needs the connection" : undefined}
      class="tap flex w-full items-center justify-between gap-3 rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 text-left text-sm text-surface-200 hover:bg-surface-800 cursor-pointer disabled:opacity-50"
    >
      <span>Log out</span>
      {#if isOffline}<span class="text-xs text-surface-400">Needs the connection</span>{/if}
    </button>
  </section>

  <nav aria-label="Legal" class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2">
    <a href="/privacy" class="tap inline-flex items-center text-sm text-surface-400 underline underline-offset-2 hover:text-surface-200">Privacy policy</a>
    <a href="/terms" class="tap inline-flex items-center text-sm text-surface-400 underline underline-offset-2 hover:text-surface-200">Terms of service</a>
  </nav>
</Page>
