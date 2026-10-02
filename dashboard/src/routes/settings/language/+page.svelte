<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import { CONTENT_LANGUAGES, UI_LANGUAGES } from "$pipeline/config/languages";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  $effect(() => {
    setPageContext({
      surface: "global",
      route: "/settings/language",
      digest: `Language settings: interface ${data.settings.uiLanguage}, content ${data.settings.contentLanguage}.`,
    });
  });

  let submitting = $state(false);
</script>

<Page title="Language" size="app" class="flex flex-col gap-6">
  <div class="flex flex-col gap-1">
    <h1 class="text-xl font-bold text-surface-50">Language</h1>
    <p class="text-xs text-surface-400 max-w-prose">
      The two settings are independent: the interface can stay in one language while the briefing, questions and assistant replies are written in another.
    </p>
  </div>

  <form
    method="POST"
    action="?/save"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update({ reset: false });
        submitting = false;
      };
    }}
    class="flex flex-col gap-6 max-w-3xl w-full mx-auto"
  >
    <section class="rounded-lg border border-surface-700 bg-surface-900 px-4 sm:px-5 py-4 flex flex-col gap-3">
      <label class="flex flex-col gap-1 text-sm font-semibold text-surface-100">
        Content language
        <select name="contentLanguage" value={data.settings.contentLanguage} class="input-base-flush font-normal">
          {#each Object.entries(CONTENT_LANGUAGES) as [code, lang] (code)}
            <option value={code}>{lang.native}{lang.native === lang.name ? "" : ` (${lang.name})`}</option>
          {/each}
        </select>
      </label>
      <p class="text-xs text-surface-400">
        What the AI writes for you: the briefing, the deep dives, quick action labels, questions and chat replies. It applies from the next run; reports already written stay as they are. Section headings and the page layout stay in the interface language.
      </p>
    </section>

    <section class="rounded-lg border border-surface-700 bg-surface-900 px-4 sm:px-5 py-4 flex flex-col gap-3">
      <label class="flex flex-col gap-1 text-sm font-semibold text-surface-100">
        Interface language
        <select name="uiLanguage" value={data.settings.uiLanguage} class="input-base-flush font-normal">
          {#each Object.entries(UI_LANGUAGES) as [code, lang] (code)}
            <option value={code}>{lang.native}{lang.native === lang.name ? "" : ` (${lang.name})`}</option>
          {/each}
        </select>
      </label>
      <p class="text-xs text-surface-400">
        Menus, buttons and labels. Fewer languages are offered here because every text has to be translated by hand. The choice is saved, but the interface is English only until translations ship.
      </p>
    </section>

    <div>
      <button
        type="submit"
        disabled={submitting}
        class="tap px-4 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors disabled:opacity-50"
      >Save</button>
    </div>
  </form>
</Page>
