<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import { focusFrom } from "$lib/assistant/pageContext";
  import Page from "$lib/components/Page.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { fmtDateTime } from "$lib/format";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/rules",
      digest: `Standing rules: ${data.rules.length} rows in standing_context, injected into every Section 2 prompt.`,
      focus: focusFrom(data.rules, "standing_context", (rule) => ({ id: rule.key, label: rule.value })),
    });
  });

  let adding = $state(false);
  let editing = $state<string | null>(null);
  let showPreview = $state(false);

  const SOURCE_LABEL: Record<string, string> = {
    context_builder: "Harvested",
    user: "Yours",
    system: "System",
  };

  /** Exactly what the block looks like where it lands in the Section 2 prompt. */
  const preview = $derived(
    data.rules.length === 0
      ? "standing_rules: null"
      : `standing_rules: [\n${data.rules.map((rule) => `  ${JSON.stringify(rule.value)}`).join(",\n")}\n]`,
  );
</script>

<Page title="Rules" size="read" class="flex flex-col gap-5">
  <div class="flex flex-col gap-1">
    <h1 class="text-xl font-bold text-surface-50">Standing rules</h1>
    <p class="text-xs text-surface-400 max-w-prose">
      Persistent rules and preferences from <code>standing_context</code>, injected into the
      Section 2 prompt on every run. The synthesis follows them silently rather than announcing
      them. Harvested rules came from your Keep notes; editing one marks it as yours, so a
      Context Builder re-run leaves it alone.
    </p>
  </div>

  {#if form?.error}
    <p class="rounded-lg border border-error-700 bg-error-950 px-4 py-3 text-sm text-error-200">{form.error}</p>
  {:else if form?.message}
    <p class="rounded-lg border border-success-700 bg-success-950 px-4 py-3 text-sm text-success-200">{form.message}</p>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <button
      onclick={() => (adding = !adding)}
      class="tap px-3 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors"
    >{adding ? "Cancel" : "+ New rule"}</button>
    <button
      onclick={() => (showPreview = !showPreview)}
      aria-expanded={showPreview}
      class="tap px-3 py-1.5 rounded text-sm border border-surface-700 bg-surface-900 text-surface-300 hover:bg-surface-800 cursor-pointer transition-colors"
    >{showPreview ? "Hide" : "Show"} the prompt block</button>
  </div>

  {#if showPreview}
    <pre class="text-xs text-surface-200 bg-surface-950 border border-surface-800 rounded-lg px-3 py-3 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{preview}</pre>
  {/if}

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
      <label class="flex flex-col gap-1 text-xs text-surface-400">
        Key
        <input
          name="key"
          required
          placeholder="daily_life_rules"
          pattern="[a-z0-9_]{'{'}2,64{'}'}"
          class="input-base-flush w-full sm:w-72 font-mono"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-surface-400">
        Rule
        <textarea name="value" required rows="3" placeholder="What should always be true of a briefing?" class="input-base-flush w-full resize-y"></textarea>
      </label>
      <button
        type="submit"
        class="tap self-start px-4 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer"
      >Add rule</button>
    </form>
  {/if}

  {#if data.rules.length === 0}
    <EmptyState
      title="No standing rules yet."
      hint="The Context Builder seeds these from your Keep notes; you can also write one here."
    />
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.rules as rule (rule.id)}
        <li class="rounded-lg border border-surface-700 bg-surface-900 px-4 sm:px-5 py-4 flex flex-col gap-2">
          {#if editing === rule.id}
            <form
              method="POST"
              action="?/update"
              use:enhance={() => async ({ update }) => {
                editing = null;
                await update();
              }}
              class="flex flex-col gap-2"
            >
              <input type="hidden" name="id" value={rule.id} />
              <textarea name="value" rows="3" aria-label="Rule text" class="input-base-flush w-full resize-y">{rule.value}</textarea>
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
            <button
              onclick={() => (editing = rule.id)}
              class="w-full text-left bg-transparent border-none p-0 text-sm text-surface-100 whitespace-pre-wrap break-words cursor-text hover:bg-surface-800/40 rounded transition-colors"
              title="Click to edit"
            >{rule.value}</button>
          {/if}

          <div class="flex flex-wrap items-center gap-2 text-xs text-surface-400">
            <code class="break-all">{rule.key}</code>
            <Badge tone={rule.source === "user" ? "primary" : "muted"}>{SOURCE_LABEL[rule.source] ?? rule.source}</Badge>
            {#if rule.updatedAt}
              <span>{fmtDateTime(rule.updatedAt)}</span>
            {/if}
            <form
              method="POST"
              action="?/delete"
              use:enhance
              class="ml-auto"
            >
              <input type="hidden" name="id" value={rule.id} />
              <button
                type="submit"
                aria-label="Delete this rule"
                class="tap px-2 text-surface-400 hover:text-error-400 transition-colors cursor-pointer bg-transparent border-none text-sm"
              >✕</button>
            </form>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Page>
