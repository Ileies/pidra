import { createNote, updateNote, type Draft, type NotePatch, type NoteRow } from "#lib/notes/api.js";
import { draftTargeting, targetingPatch, targetsOf } from "#lib/notes/targeting.js";
import { toasts } from "#lib/toast.svelte.js";
import { errMessage } from "$pipeline/util/text";

function blankDraft(scope = "global"): Draft {
  return { content: "", scope, expires: "", ...draftTargeting(), saving: false, error: null };
}

/**
 * Drafts live outside the cards: a card is rebuilt when a note arrives (the stack is dealt
 * round-robin, so one more note shifts every column), and an open edit must survive that.
 * Call during component init.
 */
export function useNoteDrafts() {
  const drafts = $state<Record<string, Draft>>({});
  let composer = $state<Draft>(blankDraft());
  let composing = $state(false);

  function startEdit(note: NoteRow) {
    if (note.deleted_at || note.id in drafts) return;
    drafts[note.id] = { content: note.content, scope: note.scope, expires: note.expires_at ?? "", ...draftTargeting(note), saving: false, error: null };
  }

  function cancelEdit(note: NoteRow) {
    delete drafts[note.id];
  }

  async function saveEdit(note: NoteRow) {
    const draft = drafts[note.id];
    if (!draft || draft.saving) return;

    const content = draft.content.trim();
    if (!content) {
      draft.error = "A note cannot be empty.";
      return;
    }

    const patch: NotePatch = targetingPatch(note, draft);
    if (content !== note.content) patch.content = content;
    if (draft.scope !== note.scope) patch.scope = draft.scope;
    if ((draft.expires || null) !== (note.expires_at ?? null)) patch.expires_at = draft.expires || null;
    if (Object.keys(patch).length === 0) {
      delete drafts[note.id];
      return;
    }

    draft.saving = true;
    draft.error = null;
    try {
      await updateNote(note.id, patch);
      delete drafts[note.id];
    } catch (err) {
      // The editor stays open with the text intact: a failed save must not lose the edit.
      draft.error = errMessage(err);
      draft.saving = false;
    }
  }

  function startNew(scope: string) {
    if (composing) return;
    composer = blankDraft(scope);
    composing = true;
  }

  async function saveNew() {
    const content = composer.content.trim();
    if (!content || composer.saving) return;

    composer.saving = true;
    composer.error = null;
    try {
      await createNote({
        content, scope: composer.scope, expires_at: composer.expires || null,
        steps: [...composer.steps], applies_to: targetsOf(composer), active_from: composer.activeFrom || null,
      });
      composing = false;
      toasts.success("Note added.");
    } catch (err) {
      composer.error = errMessage(err);
      composer.saving = false;
    }
  }

  return {
    drafts,
    get composer() {
      return composer;
    },
    set composer(draft: Draft) {
      composer = draft;
    },
    get composing() {
      return composing;
    },
    set composing(on: boolean) {
      composing = on;
    },
    startEdit,
    cancelEdit,
    saveEdit,
    startNew,
    saveNew,
  };
}
