import { Hono } from "hono";
import {
  listNotes, createNote, updateNote, softDeleteNote, restoreNote, noteHistory, revertToRevision,
  wasUpdatedSince, type Actor, type NoteWrite,
} from "../../notes/store";
import { bodyOf } from "../http";

// Writes go through `src/notes/store.ts` so the UI and the note skills share one code path and
// one revision trail. The dashboard reads notes straight from Postgres, so the page still renders
// when this bridge is down; only editing needs it.

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
  }));
});

notes.post("/api/notes", async (c) => {
  const body = await bodyOf<{ id: string; content: string; scope: string; expires_at: string | null }>(c);
  const note = await createNote(
    { id: body.id, content: body.content ?? "", scope: body.scope, expiresAt: body.expires_at ?? null },
    USER,
  );
  return c.json(note, 201);
});

notes.patch("/api/notes/:id", async (c) => {
  const body = await bodyOf<{ content: string; scope: string; expires_at: string | null; base_updated_at: string | null }>(c);
  // `expires_at` is only touched when the key is actually present: absent means "leave it",
  // null means "clear it".
  const patch: NoteWrite = {};
  if (body.content !== undefined) patch.content = body.content;
  if (body.scope !== undefined) patch.scope = body.scope;
  if ("expires_at" in body) patch.expiresAt = body.expires_at ?? null;

  // Read before write, not atomic with it - acceptable for one user. `base_updated_at` only
  // ever arrives from the offline outbox; a live UI edit never sends it,
  // so `_conflict` is always false for those and costs nothing extra.
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
