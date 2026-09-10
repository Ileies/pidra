# Assistant Plan - editable notes and an app-wide AI assistant

Status: **implemented** (2026-09-10), phases A to F. What the code does now is described
throughout in the present tense; the two things this document promised and does not have are
token-level streaming and a purge for soft-deleted notes, both deliberately left out (§11, and
`TODO.md`). Everything was verified against the live database and the real model, except the
browser-side interactions, which are type-checked but not yet clicked through by hand.

Two things, one architecture:

1. `/notes` becomes directly editable (today it is add and delete only, and delete only for
   `created_by = 'user'`).
2. The context-revision chat becomes a **floating assistant** available on every dashboard page,
   scoped per page, able to change the content of the page it is on. Reports are excluded: they
   are final.

The second is the reason the first has to be done properly. As soon as a model can edit notes,
"edit" needs a revision trail, an undo, and one single code path shared with the UI, or the two
paths will drift and a bad edit becomes unrecoverable.

---

## 1. The rule that governs everything here

PIDRA already has a hard rule: **harvested context is never overwritten, only adjusted and
complemented** (`CONTEXT_REVISION_PLAN.md`). That rule covers the context document,
`standing_context`, and by extension `entities` / `contacts` (field merge with a
`previous_state` snapshot).

Notes are not harvest. `notes` is the mutable working layer: the user's own standing
instructions plus what Phase 6 writes from the `<!--SYSTEM-->` block. Editing a note in place is
correct, not a rule violation.

So the system has exactly **two editing models**, and every surface maps onto one of them:

| Model | Stores | Mechanism | Skill |
| --- | --- | --- | --- |
| **Mutable, versioned** | `notes` | in-place update, previous state appended to `note_revisions`, delete is a soft delete | `update_note`, `write_note`, `delete_note`, `restore_note` |
| **Append-only correction layer** | context document, `standing_context`, `entities`, `contacts` | `context_corrections` row that outranks the harvest; field merge only for entity/contact rows | `revise_context`, `revert_context_revision` (unchanged) |

The assistant must never blur these. The per-surface system prompt states which model applies to
the page the user is on, and the capability policy in §2 makes the wrong skill simply unavailable.

Reports (`daily_reports`, `extractions`) are a third category: **read-only to everything except
the pipeline**. See §4.

---

## 2. Surfaces and the capability policy

The assistant is not one omnipotent chat. Each dashboard route is a **surface** with a declared
capability set. This is what makes the widget feel like it belongs to the page instead of being a
generic chatbox stapled to the corner.

New file `src/ai/surfaces.ts`, the single source of truth:

```ts
export type Surface =
  | "notes" | "context" | "entities" | "report" | "sources" | "prompts" | "global";

export interface SurfaceDef {
  /** Shown in the widget header, e.g. "Notes bearbeiten". */
  label: string;
  /** Skills the model may see and call on this surface. Nothing else is exposed or accepted. */
  skills: string[];
  /** Appended to the base system prompt: what this page is and how to change it. */
  prompt: string;
  /** Widget copy: what the assistant can do here, listed to the user before the first message. */
  hints: string[];
  readOnly?: boolean;
}
```

| Surface | Route | Can write | Can read | Notes |
| --- | --- | --- | --- | --- |
| `notes` | `/notes` | `write_note`, `update_note`, `delete_note`, `restore_note` | `list_notes`, `read_context` | full note CRUD |
| `context` | `/context-builder`, `/chat` | `revise_context`, `revert_context_revision`, `write_note` | `read_context` | today's behaviour, unchanged |
| `entities` | `/entities` | `revise_context` (entity/contact merge) | `read_context`, `list_notes` | no direct row rewrite |
| `report` | `/`, `/[date]`, `/[date]/detail/[ids]` | `write_note`, `add_todo_item`, `complete_todo_item`, `add_calendar_event`, `revise_context` | `read_report`, `read_context` | **never the report itself** |
| `sources` | `/sources` | `set_source_active` (new, medium) | `read_context` | optional, phase F |
| `prompts` | `/prompts` | `propose_prompt_version` (new, medium, inserts inactive only) | - | activation stays human |
| `global` | anything unlisted | `write_note`, `add_todo_item` | `read_context`, `list_notes` | fail-closed default |

Three properties worth being explicit about:

- **Unknown route fails closed** to `global`, which cannot touch anything structural. A new page
  added later is safe by default and gets capabilities deliberately.
- **The report surface is generous about everything except the report.** Reading the briefing and
  saying "put that deadline in my todos" or "that framing about X is wrong, fix my context" has to
  work, because that is where the user actually is when they notice something wrong. What it
  cannot do is edit the briefing text.
- `send_email` and `create_file` are on **no** surface. They stay bridge-only and manual. The
  floating widget is a content editor, not a way to accidentally mail someone.

---

## 3. Enforcement lives in `executeSkill`, not in the chat loop

`CLAUDE.md` already requires that all skill calls go through `executeSkill()`, which owns risk
gating and the audit log. The surface policy goes in the same place, for the same reason the Keep
credential filter sits at the fetch choke point: a later caller must not be able to bypass it.

```ts
// src/skills/execute.ts
export interface ExecutionPolicy {
  surface: Surface;
}

export async function executeSkill(
  skillName: string,
  parameters: Record<string, unknown>,
  triggeredBy: string,
  policy?: ExecutionPolicy,   // absent = bridge/pipeline caller, existing behaviour
): Promise<ExecutionOutcome>
```

If `policy` is present and `skillName` is not in `SURFACES[policy.surface].skills`, the call is
written to `skill_executions` with `status = 'rejected'` and a reason, and the model gets back
`rejected: <skill> is not available on the <surface> page`. That failure is visible in the widget
and on `/skills`, so a policy that is too tight shows up as data instead of as silent weirdness.

Two layers, deliberately:

1. **Tool filtering** in `src/ai/chat.ts` so the model only ever sees the allowed tools. Prevents
   the frustration case where the model announces an edit it then cannot make.
2. **Server-side rejection** in `executeSkill` because a model can invent a tool name, and because
   the widget's `surface` arrives from the client and is therefore untrusted input.

---

## 4. "Reports are final" as an enforced property

The reason to state this as an invariant rather than a habit: the assistant now runs on the report
page, and the report is the most tempting thing on screen to ask for an edit of.

- No skill writes `daily_reports`, `extractions`, `raw_items` or `active_topics`. Those tables
  belong to the pipeline and to Phase 6's `<!--SYSTEM-->` parsing.
- The report surface's prompt says so plainly, and offers the alternative: a wrong fact in a
  report is either a note (`write_note`, changes tomorrow's briefing) or a context correction
  (`revise_context`, changes every future briefing). That is the honest answer anyway, since
  editing yesterday's report text fixes nothing.
- A guard test, `scripts/check-skill-writes.ts` (run from `bun run check` in the root package),
  asserts that no file under `skills/` imports `dailyReports`, `extractions`, `rawItems` or
  `activeTopics` from `src/db`. Cheap, and it catches the future skill that would quietly break
  the rule.
- One new read-only skill, `read_report` (low): returns the rendered report and the extraction
  digest for a given date so the assistant can discuss what is on screen without the client
  having to ship the whole report into the prompt on every turn.

---

## 5. Data model changes

All applied manually via a temporary Bun script with `new SQL(DATABASE_URL)`, per `CLAUDE.md`,
then deleted. `src/db/schema.ts` and `migrations/` stay in sync for reference.

### 5.1 `notes` gains mutability and a soft delete

```sql
ALTER TABLE notes ADD COLUMN updated_at  timestamptz;
ALTER TABLE notes ADD COLUMN updated_by  text;          -- user | chat | system
ALTER TABLE notes ADD COLUMN deleted_at  timestamptz;   -- soft delete, enables undo
CREATE INDEX notes_active_idx ON notes (scope, created_at DESC) WHERE deleted_at IS NULL;
```

Every consumer of `notes` must filter `deleted_at IS NULL`. There are exactly two:
`src/pipeline/phase3-context.ts:101` and `src/search/slots.ts:63`. Both get the filter in the same
commit as the migration, or a deleted note keeps steering the briefing, which is the one bug that
would make this feature actively harmful.

### 5.2 `note_revisions` - append-only, the undo substrate

```sql
CREATE TABLE note_revisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id             uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  operation           text NOT NULL,          -- update | delete | restore
  previous_content    text,
  previous_scope      text,
  previous_expires_at date,
  changed_by          text NOT NULL,          -- user | chat | system
  skill_execution_id  uuid REFERENCES skill_executions(id),
  conversation_id     uuid REFERENCES chat_conversations(id),
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX note_revisions_note_idx ON note_revisions (note_id, created_at DESC);
```

It stores the state *before* the change, mirroring `previous_state` on the correction path. One
row per mutation is enough for both "undo the last thing the AI did" and a full history panel.

### 5.3 Chat gets page context

```sql
ALTER TABLE chat_conversations ADD COLUMN surface text;        -- where it started
ALTER TABLE chat_conversations ADD COLUMN origin  text;        -- widget | page
ALTER TABLE chat_messages      ADD COLUMN page_context jsonb;  -- snapshot per turn
```

A conversation can move between pages while it stays open, so the per-turn snapshot on the message
is the authoritative record of what the assistant was looking at when it acted. `surface` on the
conversation is for grouping and labelling in `/chat`.

---

## 6. Backend

### 6.1 `src/notes/store.ts` - one owner for note mutations

The load-bearing piece. Both the dashboard's write endpoints and the note skills call this, so the
revision trail cannot be skipped by one of them.

```ts
export interface NoteWrite { content?: string; scope?: string; expiresAt?: string | null; }
export interface Actor { by: "user" | "chat" | "system"; skillExecutionId?: string; conversationId?: string; }

export async function listNotes(opts?: { scope?: string; query?: string; includeDeleted?: boolean; limit?: number }): Promise<Note[]>;
export async function createNote(input: NoteWrite & { content: string }, actor: Actor): Promise<Note>;
export async function updateNote(id: string, patch: NoteWrite, actor: Actor): Promise<Note>;
export async function softDeleteNote(id: string, actor: Actor): Promise<Note>;
export async function restoreNote(id: string, actor: Actor): Promise<Note>;
export async function noteHistory(id: string): Promise<NoteRevision[]>;
```

Rules inside the store:

- `updateNote` writes the `note_revisions` row and the `notes` update in one transaction.
- A no-op patch (identical content, scope and expiry) returns the row without writing a revision,
  so a model that re-issues the same edit does not litter the history.
- Scope validation in one place: `["global","intel","personal","contact","search"]`, currently
  duplicated in `skills/write_note.ts` and `dashboard/.../notes/+page.server.ts`.
- `createdBy` is never rewritten. A user edit of a Phase 6 note keeps `created_by = 'system'` and
  sets `updated_by = 'user'`, so the page can honestly show "written by the pipeline, edited by
  you".

### 6.2 Skills

| Skill | Risk | Notes |
| --- | --- | --- |
| `list_notes` | low | new. Params: `scope?`, `query?`, `limit?`. Returns `id`, content, scope, provenance. The assistant needs real ids before it can edit. |
| `update_note` | low | new. Params: `note_id` (required), `content?`, `scope?`, `expires_at?`. At least one field required. |
| `restore_note` | low | new. Params: `note_id`. Undoes a soft delete. |
| `write_note` | low | rewired through the store; gains `expires_at`. |
| `delete_note` | low | rewired to `softDeleteNote`. Stays `low` because it is now reversible. |
| `read_report` | low | new, read-only. Params: `date?` (default today). |
| `set_source_active` | medium | new, phase F. |
| `propose_prompt_version` | medium | new, phase F. Always inserts `active = false`. |

`delete_note` staying `low` is a deliberate call: gating it behind `pending_confirmation` on
`/skills` would break the conversational flow for the most common destructive action, and a soft
delete with a visible undo is the better protection. Nothing is actually lost.

The skills receive the actor from `executeSkill`. That needs a small addition: `executeSkill`
already creates the `skill_executions` row before calling `skill.execute`, so it can pass
`{ by, skillExecutionId, conversationId }` through as a reserved `__actor` parameter, or better,
extend the `Skill.execute` signature to `(params, ctx)` with `ctx = { executionId, triggeredBy,
conversationId }`. The second is cleaner and touches 12 skill files with a signature change only.

### 6.3 `src/ai/chat.ts` - context, per-surface prompt, streaming

Changes to the existing loop, none of them structural:

```ts
export interface TurnContext {
  surface: Surface;
  route: string;
  /** Rendered by the page: filters, visible rows, selection. Capped hard at 2000 chars. */
  digest?: string;
  focus?: { kind: string; id: string; label?: string }[];
}

export async function* streamMessage(
  userMessage: string,
  conversationId: string | undefined,
  ctx: TurnContext,
): AsyncGenerator<TurnEvent>;

export type TurnEvent =
  | { type: "conversation"; id: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; status: string; message: string }
  | { type: "text"; text: string }
  | { type: "done"; toolCalls: ChatToolCall[]; touched: string[] }
  | { type: "error"; message: string };
```

- `sendMessage()` stays as a thin consumer of `streamMessage` so the existing bridge endpoint and
  `/chat` page keep working during the migration.
- The system prompt becomes `BASE_PROMPT + SURFACES[surface].prompt + renderedPageContext`. The
  base prompt keeps the current honesty rules (look before you write, one fact per call, ask when
  ambiguous, confirm briefly) since they apply to notes just as much as to corrections.
- `touched` in the `done` event lists the stores the turn wrote (`"notes"`, `"context"`,
  `"entities"`). The widget uses it to decide whether to call `invalidateAll()`. Without it the
  page silently shows stale data after an edit, which is the single most likely UX failure of this
  whole feature.
- **History cap.** `buildHistory` currently replays every message of a conversation with a tool
  log appended. With a widget that is always one click away, conversations will get long. Cap at
  the last 20 messages plus 8000 characters of tool log, oldest-first truncation.
- Model output text can arrive in several rounds when tool calls are interleaved; keep the
  existing behaviour of the last text winning, but emit `text` events as they come so the panel
  shows progress rather than a spinner.

Only text streaming is a real question mark: the OpenAI Responses call in `src/ai/openai.ts` is
currently non-streaming. Phase D can ship with **event streaming without token streaming**
(`tool_call` / `tool_result` events arrive live, the final text arrives in one piece). That already
removes the dead-air problem, because the wait is dominated by flex-tier queueing plus tool
rounds, not by token emission. Token streaming is an independent later change to `openai.ts`.

### 6.4 Bridge endpoints (`src/server/index.ts`)

```
GET    /api/assistant/surfaces          -> the surface registry, for widget hints
POST   /api/assistant/chat              -> SSE stream (hono/streaming streamSSE)
POST   /api/chat                        -> unchanged, non-streaming, JSON
GET    /api/notes                       -> list, filters, includeDeleted
POST   /api/notes                       -> create
PATCH  /api/notes/:id                   -> update
DELETE /api/notes/:id                   -> soft delete
POST   /api/notes/:id/restore           -> restore
GET    /api/notes/:id/history           -> revisions
```

Notes **writes** go through the bridge so `src/notes/store.ts` stays the only writer. Notes
**reads** stay in `dashboard/.../notes/+page.server.ts` against Postgres directly, as today, so
the page still renders when the bridge is down. The dashboard is a separate package and does not
import from `src/`, which is why the store is reached over HTTP rather than by import.

---

## 7. Frontend

### 7.1 The floating assistant

Mounted once in `dashboard/src/routes/+layout.svelte`, which is currently three lines. Because
SvelteKit navigation is client-side after hydration, the widget and its conversation survive
navigation between pages for free. A hard reload restores the conversation id from
`sessionStorage`.

Components:

```
dashboard/src/lib/assistant/state.svelte.ts    // runes store: open, conversation, messages, streaming, pageContext
dashboard/src/lib/assistant/Assistant.svelte   // FAB + panel shell, portal, focus handling
dashboard/src/lib/assistant/Panel.svelte       // transcript + composer
dashboard/src/lib/assistant/Message.svelte     // one message, markdown via marked (already a dep)
dashboard/src/lib/assistant/ToolChip.svelte    // one skill call, plain-language label + details
dashboard/src/lib/assistant/pageContext.ts     // setPageContext() helper + route fallback table
```

**States**

1. *Collapsed*: circular button, bottom right, `fixed bottom-5 right-5 z-40` (page headers are
   `z-10`, so no conflict). Shows a dot badge when the last turn wrote something the user has not
   looked at yet.
2. *Panel*: `w-[26rem] max-h-[70vh]`, anchored bottom right, own scroll container, sticky composer.
   Header shows the surface label ("Notes bearbeiten") and, on `report`, a read-only marker.
3. *Expanded*: `w-[40rem] max-h-[85vh]` toggle, plus a link to `/chat` for the full three-column
   view with the conversation list.
4. *Mobile* (`< 640px`): full-screen sheet, composer pinned above the keyboard, swipe-down or a
   close button to dismiss.

**Interaction**

- `Ctrl/Cmd + K` toggles. `Esc` closes (and cancels an in-flight turn if one is running).
- `Enter` sends, `Shift + Enter` newlines. The current `/chat` page uses a plain textarea with a
  Send button and no keyboard send, which is fine there and wrong for a widget.
- Draft text persists per conversation in `localStorage`, so an accidental close loses nothing.
- An in-flight turn is cancellable via `AbortController`. Navigating away does **not** cancel it:
  the write is often the point of the request. The panel keeps streaming on the new page.
- Empty state lists `SURFACES[surface].hints` as three concrete example sentences for *this* page,
  not generic filler. This is the main discoverability mechanism.

**After a write**

1. `tool_result` arrives, the tool chip flips to its executed state with a plain-language label
   ("Notiz aktualisiert" rather than `update_note`).
2. On `done` with a non-empty `touched`, the widget calls `invalidateAll()`.
3. Ids from `touched` rows are pushed into a small client store; the affected rows on the page get
   a 2-second highlight ring. The user sees what changed without hunting.
4. Anything reversible gets an inline undo button on the tool chip, wired to `restore_note` or to
   the correction revert endpoint. Undo is one click at the site of the change, not a trip to
   another page.
5. `pending_confirmation` renders as a warning chip linking to `/skills`. `rejected` renders the
   reason verbatim, which is how a too-tight surface policy surfaces itself.

**Accessibility**

`role="dialog"` with `aria-label`, focus moves into the composer on open and back to the FAB on
close, focus trapped while the panel is open on mobile, `aria-live="polite"` on the transcript so
new assistant text is announced, tool chips are real `<details>` elements (as `/chat` already
does), every control reachable by keyboard.

### 7.2 Page context registration

Each page declares what it is showing, in one call:

```svelte
<script lang="ts">
  import { setPageContext } from "$lib/assistant/pageContext";
  let { data } = $props();

  $effect(() => setPageContext({
    surface: "notes",
    route: "/notes",
    digest: `Filter: ${data.scopeFilter || "alle"}. ${data.notes.length} Notes sichtbar.`,
    focus: data.notes.slice(0, 30).map((n) => ({ kind: "note", id: n.id, label: n.content.slice(0, 80) })),
  }));
</script>
```

The `focus` list is what makes "delete the second note about the newsletter" work: the model gets
real ids for what is on screen and does not have to guess or call `list_notes` first. Capped at 30
rows and 80 characters each to keep the prompt small.

Routes that do not call `setPageContext` fall back to a route-to-surface table, and an unmatched
route falls back to `global`. The report routes are in the table explicitly, so the report surface
applies even if the page component never registers.

### 7.3 `/notes` direct editing

The page is rewritten to Svelte 5 runes on the way (it is one of seven pages still on `export let`
/ `on:click`, which the runes-only convention rules out; only `/chat` and `/context-builder` are
migrated today). The other six are left alone here - migrating them is its own task, not part of
this feature.

Layout per note:

- Content is click-to-edit: a textarea replaces the paragraph in place, autosizing, pre-filled and
  focused with the cursor at the end. `Ctrl/Cmd + Enter` or blur saves, `Esc` cancels with the
  original text restored. Save is optimistic with rollback on error.
- Scope is an inline select that saves on change. Expiry is an inline date input, clearable.
- Header row: search box (server-side `ILIKE` on content), scope filter, a sort toggle
  (newest / oldest / recently edited), and a trash toggle showing soft-deleted notes with restore.
- Provenance line: `created_by`, `updated_by` and the edit timestamp, plus a "3 Änderungen"
  disclosure that loads `note_revisions` on demand and offers a one-click revert per revision.
- Delete is now a soft delete for both user and system notes, with an undo toast (8 seconds) and
  the trash view as the backstop. The current restriction to `created_by = 'user'` goes away: a
  wrong Phase 6 note is exactly the thing that needs deleting.
- Multi-select with checkboxes for bulk scope change and bulk delete. Cheap once the store exists,
  and the fastest way to clean up after a pipeline run that wrote noise.

### 7.4 `/chat` after the change

Kept, and reduced to a thin wrapper: the same `Panel.svelte` in a wide layout, plus the
conversation list and the corrections sidebar it already has. It becomes the place for long
sessions and for reviewing what the widget did, with a surface badge per conversation. No second
transcript implementation.

---

## 8. Failure modes and what happens

| Failure | Behaviour |
| --- | --- |
| Bridge down | The widget shows the named error the proxy already produces ("Skills bridge unreachable at ..."). `/notes` still renders and still edits nothing (writes fail loudly, no silent local state). |
| Model edits the wrong note | `note_revisions` + per-revision revert; undo chip on the tool call. |
| Model calls a skill not on the surface | `rejected` in the audit log and in the panel, with the reason. |
| Model loops on a failing tool | Existing `MAX_TOOL_ROUNDS = 8` hard stop, unchanged. |
| Client sends a forged surface | `executeSkill` re-checks against the registry; the client cannot widen its own capabilities. |
| Soft-deleted note still influencing the briefing | Prevented by the `deleted_at IS NULL` filter in `phase3-context.ts` and `search/slots.ts`, shipped with the migration. |
| Conversation grows unboundedly | History cap of 20 messages / 8000 chars of tool log. |
| Two turns in flight at once | The composer is disabled while streaming; a queued second message is not supported and not needed. |

---

## 9. Build order

Each phase is independently shippable and independently useful, and each ends with
`bun run check` in the root package and `bun run check` in `dashboard/`.

**Phase A - notes become editable (no AI).**
Migration 5.1 + 5.2, `deleted_at` filters in the two consumers, `src/notes/store.ts`, bridge notes
endpoints, `/notes` rewritten to runes with inline editing, trash, undo, history, search, bulk
actions.
*Done when:* a note can be edited, soft-deleted, restored and reverted from the UI, and a
soft-deleted note no longer reaches the briefing payload.

**Phase B - the note skills.**
`Skill.execute(params, ctx)` signature change across the 12 existing skills, `list_notes`,
`update_note`, `restore_note`, `write_note` and `delete_note` rewired through the store.
*Done when:* the existing `/chat` can list, edit and delete notes, and every edit shows up in
`note_revisions` with `changed_by = 'chat'` and the right `skill_execution_id`.

**Phase C - surfaces and enforcement.**
`src/ai/surfaces.ts`, `ExecutionPolicy` in `executeSkill`, tool filtering in `chat.ts`,
`read_report`, `scripts/check-skill-writes.ts` wired into root `bun run check`.
*Done when:* a `revise_context` call on the `notes` surface is rejected and logged, and the guard
test fails if a skill imports `dailyReports`.

**Phase D - context-aware, streaming turns.**
`TurnContext`, `streamMessage`, per-surface prompts, history cap, `touched`,
`POST /api/assistant/chat` SSE on the bridge plus the SvelteKit passthrough proxy.
*Done when:* a turn's tool calls appear in a curl SSE stream as they execute.

**Phase E - the floating widget.**
The `lib/assistant/` components, layout mount, `setPageContext` on every page, invalidation and
row highlighting, mobile sheet, keyboard and a11y, `/chat` refactored onto `Panel.svelte`.
*Done when:* "mach aus der zweiten Notiz oben ein intel-Note" works from `/notes`, the row updates
without a manual reload, and the same request on `/[date]` is refused with an explanation while
"schreib das als Note" on the same page succeeds.

**Phase F - optional surfaces.**
`set_source_active`, `propose_prompt_version`, `/sources` and `/prompts` surfaces.
*Done when:* the assistant can disable a source from `/sources` and can propose but not activate a
prompt version from `/prompts`.

---

## 10. Files

**New**
```
src/notes/store.ts                          the only writer of notes and note_revisions
src/ai/surfaces.ts                          surface registry: skills, prompt, hints
skills/list_notes.ts, update_note.ts, restore_note.ts, read_report.ts
skills/set_source_active.ts, propose_prompt_version.ts        (phase F)
scripts/check-skill-writes.ts               guard: no skill writes report tables
dashboard/src/lib/assistant/state.svelte.ts, Assistant.svelte, Panel.svelte,
                            Message.svelte, ToolChip.svelte, pageContext.ts
dashboard/src/routes/api/assistant/chat/+server.ts            SSE proxy
dashboard/src/routes/api/notes/[...path]/+server.ts           notes write proxy
```

**Changed**
```
src/db/schema.ts                notes columns, note_revisions, chat surface/page_context
src/skills/loader.ts            Skill.execute(params, ctx)
src/skills/execute.ts           ExecutionPolicy, actor context, rejection path
src/ai/chat.ts                  TurnContext, streamMessage, per-surface prompt, history cap, touched
src/server/index.ts             assistant + notes endpoints
src/pipeline/phase3-context.ts  deleted_at IS NULL
src/search/slots.ts             deleted_at IS NULL
skills/write_note.ts, delete_note.ts        through the store
dashboard/src/routes/+layout.svelte         mount the widget
dashboard/src/routes/notes/+page.{svelte,server.ts}   runes rewrite, editing, search, trash
dashboard/src/routes/chat/+page.svelte      reuse Panel.svelte
every other dashboard page                  one setPageContext() call
CLAUDE.md                                   surfaces, "reports are final", notes are mutable
TODO.md                                     phases A-F
```

---

## 11. Deliberately not built

- **Report editing, in any form.** No skill, no endpoint, no exception.
- **In-place rewriting of the context document or `standing_context`.** The correction layer stays
  the only mechanism; the widget on `/context-builder` behaves exactly as `/chat` does today.
- **Answering the question gate from the widget.** It writes `contacts.relationship` on a
  45-minute deadline; it deserves its own deliberate flow, not a side effect of a chat.
- **Multi-turn autonomous agents.** Same `MAX_TOOL_ROUNDS = 8` per user turn, no background work,
  no scheduled assistant runs.
- **Vector search over notes.** The no-vector-store rule holds; `list_notes` is `ILIKE` plus
  scope, and the page's `focus` list covers "the note I am looking at".
- **Token-level streaming**, until event streaming has proven insufficient in daily use.
- **A second chat model or provider.** Everything goes through `src/ai/openai.ts` with
  `store: false` and the flex tier.

---

## 12. Open decisions

1. **Soft delete for notes** (recommended yes). Costs a column and a filter in two consumers, buys
   a reversible destructive action for the AI path.
2. **AI editing of Phase 6 system notes** (recommended yes). They are the most likely notes to be
   wrong, provenance is preserved in `created_by` / `updated_by`, and the revision trail makes it
   recoverable.
3. **`Skill.execute(params, ctx)` signature change** (recommended yes). Touches all 12 skill files
   mechanically, and is the clean way to get the actor and execution id into the revision trail.
   The alternative, a magic `__actor` parameter, is smaller and worse.
4. **Phase F surfaces** (`/sources`, `/prompts`). Both are configuration rather than content, so
   they are optional. `/sources` is the more useful of the two; `/prompts` only ever proposes.
