import { Hono } from "hono";
import {
  listNotes, createNote, updateNote, softDeleteNote, restoreNote, noteHistory, revertToRevision,
  wasUpdatedSince, type Actor, type NoteWrite,
} from "../../notes/store";
import type { NoteTargets } from "../../notes/select";
import { bodyOf } from "../http";

// Writes go through `src/notes/store.ts` (shared revision trail). The dashboard reads notes straight
// from Postgres, so only editing needs this bridge.

/** The dashboard is the only caller, and it is the user acting. */
const USER: Actor = { by: "user" };

export const notes = new Hono();

notes.get("/api/notes", async (c) => {
  const include = c.req.query("include");
  return c.json(await listNotes({
    scope: c.req.query("scope") || undefined,
    query: c.req.query("query") || undefined,
    include: include === "deleted" || include === "all" ? include : "active",
    sort: c.req.query("sort") as "newest" | "oldest" | "edited" | undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    narrowness: c.req.query("narrowness") || undefined,
    step: c.req.query("step") || undefined,
    target: c.req.query("target") || undefined,
    dormant: c.req.query("dormant") === "1",
  }));
});

/** Targeting as the dashboard sends it; every key optional, and a key that is absent leaves the note's value alone. */
interface TargetingBody {
  steps?: string[];
  applies_to?: NoteTargets | null;
  active_from?: string | null;
}

/** Only the keys the body actually carries, so an edit of the text never resets targeting. */
function targetingOf(body: TargetingBody): NoteWrite {
  const out: NoteWrite = {};
  if (body.steps !== undefined) out.steps = body.steps;
  if (body.applies_to !== undefined) out.appliesTo = body.applies_to;
  if (body.active_from !== undefined) out.activeFrom = body.active_from;
  return out;
}

notes.post("/api/notes", async (c) => {
  const body = await bodyOf<{ id: string; content: string; scope: string; expires_at: string | null } & TargetingBody>(c);
  const note = await createNote(
    { id: body.id, content: body.content ?? "", scope: body.scope, expiresAt: body.expires_at ?? null, ...targetingOf(body) },
    USER,
  );
  return c.json(note, 201);
});

notes.patch("/api/notes/:id", async (c) => {
  const body = await bodyOf<{ content: string; scope: string; expires_at: string | null; base_updated_at: string | null } & TargetingBody>(c);
  // `expires_at` is only touched when the key is actually present: absent means "leave it",
  // null means "clear it".
  const patch: NoteWrite = targetingOf(body);
  if (body.content !== undefined) patch.content = body.content;
  if (body.scope !== undefined) patch.scope = body.scope;
  if ("expires_at" in body) patch.expiresAt = body.expires_at ?? null;

  // `base_updated_at` only arrives from the offline outbox; `_conflict` (the row moved meanwhile) is
  // false for live edits. The edit is applied either way (last write wins, deliberate for a
  // single-user notes layer); the outbox stores the flag and `NoteCard.svelte` shows it.
  const conflict = "base_updated_at" in body
    ? await wasUpdatedSince(c.req.param("id"), body.base_updated_at ?? null)
    : false;
  const note = await updateNote(c.req.param("id"), patch, USER);
  return c.json({ ...note, _conflict: conflict });
});

notes.delete("/api/notes/:id", async (c) => c.json(await softDeleteNote(c.req.param("id"), USER)));

notes.post("/api/notes/:id/restore", async (c) => c.json(await restoreNote(c.req.param("id"), USER)));

notes.get("/api/notes/:id/history", async (c) => c.json(await noteHistory(c.req.param("id"))));

notes.post("/api/notes/revisions/:id/revert", async (c) => c.json(await revertToRevision(c.req.param("id"), USER)));
