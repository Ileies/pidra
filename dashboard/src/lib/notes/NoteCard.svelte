<script lang="ts">
  import { SCOPE_INFO, SCOPE_FALLBACK_CLASS, type Draft, type NoteRow } from "#lib/notes/api.js";
  import { fmtAgo, fmtDateTime, fmtDay, isoDay, utcDay } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { intentIsFor } from "#lib/offline/outbox.js";
  import FailedWrite from "#lib/offline/FailedWrite.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import NoteEditor from "#lib/notes/NoteEditor.svelte";
  import { isDormant, targetingBadges, targetingPatch } from "#lib/notes/targeting.js";
  import Check from "@lucide/svelte/icons/check";

  interface Props {
    note: NoteRow;
    selected: boolean;
    /** Selection mode: a tap on the card toggles it instead of opening the editor. */
    selecting: boolean;
    /** Set while the assistant's last turn touched this note, for the change highlight. */
    highlighted?: boolean;
    /** Present while the card is open for editing; owned by the page so it outlives a re-render. */
    draft: Draft | undefined;
    onEdit: (note: NoteRow) => void;
    onToggleSelect: (id: string, selected: boolean) => void;
    onSave: (note: NoteRow) => void;
    onCancel: (note: NoteRow) => void;
    onDelete: (note: NoteRow) => void;
    onRestore: (note: NoteRow) => void;
    onHistory: (note: NoteRow) => void;
  }

  let {
    note, selected, selecting, highlighted = false, draft = $bindable(),
    onEdit, onToggleSelect, onSave, onCancel, onDelete, onRestore, onHistory,
  }: Props = $props();

  const deleted = $derived(note.deleted_at !== null);

  /** A small "queued" chip rather than pretending an offline write already reached the server. */
  const queued = $derived(offline.pending.some((i) => intentIsFor(i, "note", note.id)));
  const failedWrites = $derived(offline.failed.filter((i) => intentIsFor(i, "note", note.id)));

  const dirty = $derived(
    !!draft && (
      draft.content.trim() !== note.content ||
      draft.scope !== note.scope ||
      (draft.expires || null) !== (note.expires_at ?? null) ||
      Object.keys(targetingPatch(note, draft)).length > 0
    ),
  );

  const badges = $derived(targetingBadges(note));

  /** Whether the briefing really reads this note: a note too narrow to ever match shows up here. */
  const loads = $derived.by(() => {
    if (deleted) return null;
    const dormant = isDormant(note, utcDay());
    if (note.load_count === 0) return { text: "never loaded", dormant, title: "No briefing step has read this note since loads were first recorded" };
    return {
      text: `loaded ${note.load_count}x, last ${fmtDay(note.last_loaded_on!)}`,
      dormant,
      title: "Step and run-day pairs this note went into a model call or search",
    };
  });

  const long = $derived(note.content.length > 420 || note.content.split("\n").length > 9);
  let expanded = $state(false);

  function authorLabel(who: string | null): string {
    return displayLabel(who, "The system");
  }

  /** The owner's own notes carry no author; anything else says who, since provenance stays visible. */
  const when = $derived.by(() => {
    const parts: string[] = [];
    if (note.created_by !== "user") parts.push(authorLabel(note.created_by));
    if (note.updated_at && note.updated_by) {
      const by = note.updated_by === "user" ? "" : ` by ${authorLabel(note.updated_by).toLowerCase()}`;
      parts.push(`edited${by} ${fmtAgo(note.updated_at)}`);
    } else {
      parts.push(fmtAgo(note.created_at));
    }
    return parts.join(" · ");
  });

  const provenance = $derived(
    `${authorLabel(note.created_by)} · ${fmtDateTime(note.created_at)}` +
      (note.updated_by ? ` · edited by ${authorLabel(note.updated_by).toLowerCase()} ${fmtDateTime(note.updated_at)}` : ""),
  );

  const expiry = $derived.by(() => {
    if (!note.expires_at) return null;
    const today = isoDay();
    const expired = note.expires_at < today;
    const soon = !expired && note.expires_at <= isoDay(new Date(Date.now() + 7 * 86_400_000));
    return {
      text: `${expired ? "expired" : "expires"} ${fmtDay(note.expires_at)}`,
      tone: expired ? "text-error-400" : soon ? "text-warning-400" : "text-surface-400",
    };
  });

  function open() {
    if (selecting) onToggleSelect(note.id, !selected);
    else onEdit(note);
  }

  function footerClick(e: MouseEvent) {
    if (!selecting) return;
    if ((e.target as HTMLElement).closest("button")) return;
    onToggleSelect(note.id, !selected);
  }
</script>

<div
  class="group relative rounded-lg border transition-colors {deleted
    ? 'bg-surface-950 border-surface-800'
    : 'bg-surface-900 border-surface-700 hover:border-surface-600'} {selected ? 'border-primary-600 ring-1 ring-primary-600' : ''} {highlighted ? 'ring-2 ring-primary-600' : ''}"
>
  {#if !draft}
    <!-- The corner mark straddles the border so it never covers the text. On a mouse it shows on hover;
         on touch, selection starts from the toolbar's Select. -->
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label="Select this note"
      onclick={() => onToggleSelect(note.id, !selected)}
      class="absolute -left-2 -top-2 z-10 h-5 w-5 items-center justify-center rounded-full border p-0 {selecting || selected
        ? 'flex'
        : 'hidden lg:group-hover:flex'} {selected
        ? 'border-primary-500 bg-primary-600 text-surface-50'
        : 'border-surface-500 bg-surface-900 text-transparent hover:border-primary-500'}"
    ><Check class="h-3 w-3" aria-hidden="true" /></button>
  {/if}

  {#if draft}
    <NoteEditor
      bind:draft
      {dirty}
      existing={{ revisionCount: note.revision_count }}
      onSave={() => onSave(note)}
      onCancel={() => onCancel(note)}
      onDelete={() => onDelete(note)}
      onHistory={() => onHistory(note)}
    />
  {:else}
    {#if deleted && !selecting}
      <p class="px-4 pt-4 text-sm text-surface-300 whitespace-pre-wrap [overflow-wrap:anywhere] sm:px-5 {long && !expanded ? 'line-clamp-10' : ''}">{note.content}</p>
    {:else}
      <button
        type="button"
        onclick={open}
        aria-pressed={selecting ? selected : undefined}
        title={selecting ? "Tap to select" : "Click to edit"}
        class="block w-full border-none bg-transparent px-4 pt-4 text-left text-sm whitespace-pre-wrap [overflow-wrap:anywhere] sm:px-5 {deleted
          ? 'text-surface-300'
          : 'text-surface-100'} {long && !expanded ? 'line-clamp-10' : ''}"
      >{note.content}</button>
    {/if}

    {#if long}
      <button
        type="button"
        onclick={() => (expanded = !expanded)}
        class="tap bg-transparent border-none px-4 pt-1 text-xs text-primary-300 hover:text-primary-200 sm:px-5"
      >{expanded ? "Show less" : "Show more"}</button>
    {/if}

    <!-- Keyboard users toggle through the content button above; this only widens the tap target. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      onclick={footerClick}
      class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-3 pt-2.5 text-xs text-surface-400 sm:px-5 {selecting ?'cursor-pointer' : ''}"
    >
      <span class="badge border {SCOPE_INFO[note.scope]?.classes ?? SCOPE_FALLBACK_CLASS}">{displayLabel(note.scope)}</span>
      {#each badges as badge (badge.text)}
        <span class="badge border border-surface-700 text-surface-300 [overflow-wrap:anywhere]" title={badge.title}>{badge.text}</span>
      {/each}
      {#if expiry}
        <span class={expiry.tone}>{expiry.text}</span>
      {/if}
      {#if loads}
        <span class={loads.dormant ? "text-warning-400" : ""} title={loads.title}>{loads.text}</span>
      {/if}
      <span title={provenance}>
        {#if deleted}Deleted {fmtAgo(note.deleted_at)}{note.source_key ? " · kept so Keep does not re-add it" : " · purged after 30 days"}{:else}{when}{/if}
      </span>
      {#if queued}
        <Badge tone="warning">Queued</Badge>
      {/if}

      <span class="ml-auto flex items-center gap-1">
        {#if deleted}
          <button
            type="button"
            onclick={() => onRestore(note)}
            class="btn btn-sm btn-solid"
          >Restore</button>
        {:else if note.revision_count > 0}
          <button
            type="button"
            onclick={() => onHistory(note)}
            class="btn btn-quiet rounded px-1 text-xs"
          >{note.revision_count} {note.revision_count === 1 ? "change" : "changes"}</button>
        {/if}
      </span>
    </div>
  {/if}

  {#if failedWrites.length > 0 || note.conflicted}
    <div class="flex flex-col gap-2 px-4 pb-3 sm:px-5">
      {#each failedWrites as intent (intent.id)}
        <FailedWrite {intent} />
      {/each}
      {#if note.conflicted}
        <p class="text-xs text-warning-400">
          Changed on the server while this was queued offline - your edit still landed. The history has both versions.
        </p>
      {/if}
    </div>
  {/if}
</div>
