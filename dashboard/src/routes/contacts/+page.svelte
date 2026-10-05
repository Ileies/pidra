<script lang="ts">
  // `/contacts`: mirrored sender directory from `+page.ts`; edits post the form action in
  // `+page.server.ts` (online-only, goes through the bridge correction endpoint).
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Field from "#lib/components/Field.svelte";
  import { fmtDate, fmtNum } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { sync } from "#lib/offline/sync.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // An edit is a correction, which is never queued offline: replayed later, a locking merge on a
  // row that moved meanwhile does lasting damage.

  $effect(() => toastFormResult(form));

  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/contacts",
      digest: `Sender directory: ${data.contacts.length} contacts. Not a social graph - it answers who a From address belongs to and how much triage should care.`,
      focus: focusFrom(data.contacts, "contact", (contact) => ({
        id: contact.identifier,
        label: `${contact.name ?? contact.identifier}${contact.relationship ? ` - ${contact.relationship}` : ""}`,
      })),
    });
  });

  const PRIORITY_TONE = {
    critical: "error",
    high: "warning",
    normal: "muted",
    low: "muted",
  } as const;

  const PRIORITIES = ["critical", "high", "normal", "low"];

  let editing = $state<string | null>(null);
  let submitting = $state(false);
</script>

<Page title="Contacts" size="app" class="flex flex-col gap-5">
  <!-- Six rows from 1,432 emails is the correct outcome, not a seeding bug, and saying so here
       saves the next person from going looking for the missing rows (CLAUDE.md §8). -->
  {#if offline.isOffline}
    <p class="text-xs text-warning-400 max-w-prose">
      Editing needs the connection: a change here is recorded as a correction, and corrections are
      never queued offline.
    </p>
  {/if}

  {#if data.contacts.length === 0}
    <EmptyState
      title="No contacts yet."
      hint="Contacts are seeded by the Context Builder and added by Phase 6 when a briefing names a sender worth remembering."
    />
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.contacts as contact (contact.id)}
        {@const open = editing === contact.id}
        <Card as="li" class="px-4 py-3 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-surface-100 break-all">{contact.name ?? contact.identifier}</span>
            <Badge tone={PRIORITY_TONE[contact.priority as keyof typeof PRIORITY_TONE] ?? "muted"}>
              {displayLabel(contact.priority)}
            </Badge>
            {#if contact.relationship}
              <span class="text-xs text-surface-300">{contact.relationship}</span>
            {/if}
            {#if contact.locked}
              <Badge tone="primary" title="A correction owns this row; a Context Builder re-seed will not touch it">Corrected</Badge>
            {/if}
            <button
              type="button"
              aria-expanded={open}
              disabled={offline.isOffline && !open}
              title={offline.isOffline && !open ? "Needs the connection" : undefined}
              onclick={() => (editing = open ? null : contact.id)}
              class="btn btn-sm btn-ghost ml-auto"
            >{open ? "Cancel" : "Edit"}</button>
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-surface-400">
            {#if contact.name}<span class="break-all">{contact.identifier}</span>{/if}
            <span class="tabular-nums">{fmtNum(contact.emailCount)} emails</span>
            {#if contact.firstSeen}<span>since {fmtDate(contact.firstSeen)}</span>{/if}
          </div>

          {#if contact.contextNotes && !open}
            <p class="text-xs text-surface-300 whitespace-pre-wrap break-words">{contact.contextNotes}</p>
          {/if}

          {#if open}
            <form
              method="POST"
              action="?/update"
              use:enhance={() => {
                submitting = true;
                return async ({ update, result }) => {
                  try {
                    if (result.type === "success") editing = null;
                    await update();
                    // Written on the server, not through the outbox, so this page's offline copy
                    // only shows it after a pull; forced, because the throttle would skip it.
                    if (result.type === "success") await sync({ force: true });
                  } finally {
                    submitting = false;
                  }
                };
              }}
              class="flex flex-col gap-3 border-t border-surface-800 pt-3"
            >
              <input type="hidden" name="identifier" value={contact.identifier} />

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field name="name" label="Name" dense value={contact.name ?? ""} />
                <Field name="relationship" label="Relationship" dense value={contact.relationship ?? ""} placeholder="service, colleague, insurer…" />
                <Field name="priority" label="Priority" dense as="select" value={contact.priority}>
                  {#each PRIORITIES as priority (priority)}
                    <option value={priority}>{priority}</option>
                  {/each}
                </Field>
              </div>

              <Field name="contextNotes" label="Context for triage" dense as="textarea" rows="2" value={contact.contextNotes ?? ""} />

              <!-- The correction layer is append-only and keeps the reasoning, so it is worth
                   asking for one line of it while the change is being made. -->
              <Field name="statement" label="What is true about this sender (recorded as the correction)" dense placeholder="Leave empty to record the fields as written above." />

              <button
                type="submit"
                disabled={submitting}
                class="btn btn-md btn-primary self-start"
              >{submitting ? "Saving…" : "Save as a correction"}</button>
            </form>
          {/if}
        </Card>
      {/each}
    </ul>
  {/if}
</Page>
