<script lang="ts">
  /**
   * `/settings`: install app (`InstallApp`), notifications, language/theme, links to `/setup`,
   * email accounts, newsletters and the legal pages, and log out.
   *
   * No server load: everything here is either a link to a page that already handles its own
   * state (`/setup`, `/privacy`, `/terms`) or a client-side control (`NotifyButton`, log out, the
   * language selects) that talks to its endpoint directly. That is what keeps it mirrored rather
   * than online-only. The theme select is device-local (`$lib/theme.svelte.ts`), so it works offline.
   */
  import { jsonInit } from "#lib/http.js";
  import { errMessage } from "$pipeline/util/text";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import Page from "#lib/components/Page.svelte";
  import Card from "#lib/components/Card.svelte";
  import NotifyButton from "#lib/components/NotifyButton.svelte";
  import InstallApp from "#lib/components/InstallApp.svelte";
  import { netJson } from "#lib/offline/net.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { toasts } from "#lib/toast.svelte.js";
  import { THEME_MODES, setTheme, theme, type ThemeMode } from "#lib/theme.svelte.js";
  import { CONTENT_LANGUAGES, UI_LANGUAGES } from "$pipeline/config/languages";

  let loggingOut = $state(false);

  const ACCOUNT_LINKS = [
    { href: "/setup", title: "Passkey and PIN", hint: "Register a device, change the PIN" },
    { href: "/settings/email-accounts", title: "Email accounts", hint: "IMAP/SMTP accounts the pipeline reads" },
    { href: "/settings/newsletters", title: "Newsletter sources", hint: "RSS feeds, errors, and email sender rules" },
  ];

  // The language fields save on change, through `/api/settings`: this page has no server load
  // (it is mirrored), so the stored values are fetched here and the selects stay disabled until
  // they arrive, or while offline.
  interface Languages {
    uiLanguage: string;
    contentLanguage: string;
  }
  let languages = $state<Languages | null>(null);
  const languageDisabled = $derived(!languages || offline.isOffline);

  onMount(async () => {
    try {
      languages = await netJson<Languages>("/api/settings");
    } catch {
      // Offline or slow: the selects stay disabled, and the rest of the page is unaffected.
    }
  });

  async function saveContentLanguage(select: HTMLSelectElement) {
    if (!languages) return;
    const previous = languages.contentLanguage;
    const next = select.value;
    if (next === previous) return;
    try {
      languages = await netJson<Languages>("/api/settings", jsonInit("PATCH", { contentLanguage: next }));
      toasts.success("Content language changed. Applies from the next briefing.");
    } catch (err) {
      select.value = previous;
      toasts.error(errMessage(err));
    }
  }

  // Not queued, same as the other actions that touch live server state while offline (contact
  // edits, topic curation): logging out is disabled with the reason rather than attempted, since
  // there is no way to know locally whether the server actually forgot the session.
  async function logOut() {
    if (offline.isOffline) return;
    loggingOut = true;
    try {
      await netJson("/api/auth/logout", { method: "POST" });
      // Only once the server has forgotten the session: a failed logout keeps the data.
      await offline.clearAll().catch(() => {});
    } finally {
      await goto("/login", { invalidateAll: true });
    }
  }
</script>

<Page title="Settings" size="app" class="flex flex-col gap-6">
  <!-- Capped rather than left to fill `app`'s full width : a menu of tiles and a toggle has no
       content to grow into, and full-width rows put empty space between label and description. -->
  <div class="flex flex-1 flex-col w-full">
  <div class="flex flex-1 flex-col gap-6 max-w-3xl mx-auto w-full">
    <Card as="section" class="px-4 sm:px-5 py-4 flex items-center justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h2 id="notifications-heading" class="text-sm font-semibold text-surface-100">Notifications</h2>
        <p class="text-xs text-surface-400">Push a notification to this device when the morning briefing is ready.</p>
      </div>
      <NotifyButton variant="row" labelledby="notifications-heading" />
    </Card>

    <InstallApp />

    <Card as="section" class="px-4 sm:px-5 py-4 flex flex-col gap-4">
      <h2 class="text-sm font-semibold text-surface-100">Preferences</h2>

      <div class="flex flex-col gap-1">
        <label for="theme" class="text-sm font-semibold text-surface-100">Theme</label>
        <select
          id="theme"
          value={theme.mode}
          onchange={(event) => setTheme(event.currentTarget.value as ThemeMode)}
          class="input-base-flush font-normal"
        >
          {#each THEME_MODES as mode (mode.value)}
            <option value={mode.value}>{mode.label}</option>
          {/each}
        </select>
        <p class="text-xs text-surface-400">Applies to this device only. System follows your device's light or dark setting.</p>
      </div>

      <div class="flex flex-col gap-1">
        <label for="content-language" class="text-sm font-semibold text-surface-100">Content language</label>
        <select
          id="content-language"
          value={languages?.contentLanguage}
          disabled={languageDisabled}
          onchange={(event) => saveContentLanguage(event.currentTarget)}
          class="input-base-flush font-normal disabled:opacity-50"
        >
          {#each Object.entries(CONTENT_LANGUAGES) as [code, lang] (code)}
            <option value={code}>{lang.native}{lang.native === lang.name ? "" : ` (${lang.name})`}</option>
          {/each}
        </select>
        {#if offline.isOffline}<p class="text-xs text-surface-400">Needs the connection to change.</p>{/if}
      </div>

      <div class="flex flex-col gap-1">
        <label for="ui-language" class="text-sm font-semibold text-surface-100">Interface language</label>
        <select
          id="ui-language"
          value={languages?.uiLanguage}
          disabled
          class="input-base-flush font-normal disabled:opacity-50"
        >
          {#each Object.entries(UI_LANGUAGES) as [code, lang] (code)}
            <option value={code}>{lang.native}{lang.native === lang.name ? "" : ` (${lang.name})`}</option>
          {/each}
        </select>
        <p class="text-xs text-surface-400">Translations coming soon.</p>
      </div>
    </Card>

    <Card as="section" class="px-4 sm:px-5 py-4 flex flex-col gap-3">
      <h2 class="text-sm font-semibold text-surface-100">Account</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {#each ACCOUNT_LINKS as link (link.href)}
          <a
            href={link.href}
            class="tap flex flex-col gap-1 rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 no-underline text-sm text-surface-200 hover:bg-surface-800"
          >
            <span>{link.title}</span>
            <span class="text-xs text-surface-400">{link.hint}</span>
          </a>
        {/each}
        <button
          type="button"
          onclick={logOut}
          disabled={loggingOut || offline.isOffline}
          title={offline.isOffline ? "Needs the connection" : undefined}
          class="tap flex w-full flex-col gap-1 rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 text-left text-sm text-surface-200 hover:bg-surface-800 disabled:opacity-50"
        >
          <span>Log out</span>
          {#if offline.isOffline}<span class="text-xs text-surface-400">Needs the connection</span>{/if}
        </button>
      </div>
    </Card>

    <nav aria-label="Legal" class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2">
      <a href="/privacy" class="tap inline-flex items-center text-sm text-surface-400 underline underline-offset-2 hover:text-surface-200">Privacy policy</a>
      <a href="/terms" class="tap inline-flex items-center text-sm text-surface-400 underline underline-offset-2 hover:text-surface-200">Terms of service</a>
    </nav>
  </div>
  </div>
</Page>
