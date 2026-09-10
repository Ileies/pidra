# Context Revision - Plan

Status: implemented 2026-09-10.

## The problem

The first Context Builder run got relationships wrong: a girlfriend recorded as a friend, a
family member recorded as a girlfriend. Those mistakes are now inside the long-term context
document, which is injected into every daily briefing, so the error compounds daily.

There is currently no way to fix it short of raw SQL against pronix. `/entities` is read-only,
`contacts` has no page at all, and the context document is a JSON file on disk that only the
Context Builder writes.

## The rule this is built around

**Harvested information is never overwritten. It is adjusted and complemented.**

That is a hard constraint, not a preference. Two reasons:

1. The harvest cost ~1400 emails of extraction. A model rewriting a section to fix one sentence
   silently drops the other forty facts in it. This is exactly the failure mode `synthesizePatch`
   already warns about ("Do not shrink the document").
2. A wrong fact plus its correction carries more signal than the corrected fact alone. Knowing
   the harvest believed X and the user said "no, Y" tells later runs where the extraction is
   unreliable.

So corrections are a **layer over** the harvest, not an edit of it.

## Architecture

### 1. `context_corrections` - an append-only correction layer

One row per correction. Rows are never UPDATEd except to flip `status`, and never DELETEd.

| column | meaning |
| --- | --- |
| `target_kind` | `document` \| `standing_context` \| `entity` \| `contact` |
| `target_key` | doc heading, standing key, entity name, or contact identifier |
| `operation` | `amend` (harvest is wrong) \| `complement` (harvest is incomplete) \| `retract` (harvest states something false) |
| `statement` | the correct fact, in the user's voice - injected verbatim into the daily prompts |
| `supersedes_text` | the wrong text being corrected, quoted from the harvest |
| `rationale` | why, from the conversation |
| `previous_state` | JSONB snapshot of the row before a structured merge, so a revert is exact |
| `status` | `active` \| `reverted` |

The context document on disk is **never** rewritten. `standing_context` values are **never**
rewritten. Both are corrected purely through this layer.

### 2. Injection with explicit precedence

`loadLongTermContext()` gains a `corrections` field. `phase5-synthesis` passes it as a
top-level `context_corrections` array in both section payloads, and both section prompts get:

> `context_corrections` are the user's own corrections to `long_term_context` and
> `standing_rules`. They are authoritative. Where a correction conflicts with the profile,
> the correction wins and the profile text is wrong.

This is why the wrong text is kept: the model needs to see both to know which statement it is
being told to disregard.

### 3. Structured rows get a merge, not a rewrite

For `entity` and `contact` targets the correction *also* updates the row, because
`phase3-context` and Section 2 read those rows directly and would otherwise keep serving the
wrong value. The update is a field-level merge - only fields the correction names change, the
rest of the row is untouched - and the pre-merge row is snapshotted into `previous_state`.

Corrected rows are marked `locked = true`. `seedContacts` in the Context Builder skips locked
rows on re-seed, so a monthly update run cannot clobber a correction. (`seedEntities` already
uses `onConflictDoNothing`, and the daily `phase6` entity upsert only touches `mention_count`,
`last_mentioned` and `aliases`, so neither needed a guard.)

`complement` on `standing_context` with a new key inserts a real row with `source = 'user'` -
that is additive, so it needs no layer. `amend` and `retract` on an existing key stay in the
layer and leave the row alone.

### 4. The chat

`/chat` in the dashboard, backed by a tool-calling loop on the skills bridge.

- `src/ai/openai.ts` gains `converse()` - the Responses API with function tools, same
  `store: false` + `service_tier: "flex"` discipline as the rest of the file.
- `src/ai/chat.ts` runs the agent loop. Its tools are the entire skill registry, exposed
  automatically from `listSkills()` - so every skill the bridge has, the chat can use, and any
  skill added later shows up with no chat-side change.
- Skill calls from the chat go through the same `executeSkill()` path as the REST bridge, so
  risk gating and the `skill_executions` audit log apply identically. `critical` is rejected and
  `high` returns "needs confirmation" to the model rather than executing.
- Conversations persist in `chat_conversations` / `chat_messages`, which is also the provenance
  trail for every correction (`context_corrections.conversation_id`).

### 5. The skills

| skill | risk | what it does |
| --- | --- | --- |
| `read_context` | low | searches the context document, standing rules, entities, contacts and existing corrections |
| `revise_context` | medium | records one correction, and merges the structured row when the target has one |
| `revert_context_revision` | medium | flips a correction to `reverted` and restores `previous_state` |

`revise_context` is medium, not high: the user is in the conversation, so a second approval
click is friction rather than safety. The safety comes from being reversible - every correction
has a Revert button on `/context-builder`, and the harvest underneath is untouched either way.

## Files

- `migrations/0009_context_corrections.sql` - applied manually per the DB migrations rule
- `src/db/schema.ts` - three tables plus `locked` on `contacts` and `entities`
- `src/context/corrections.ts` - record, revert, list, format-for-prompt
- `src/ai/chat.ts`, `src/ai/openai.ts` - the agent loop
- `src/server/index.ts` - `executeSkill()` extracted, `/api/chat*` added
- `src/pipeline/long-term-context.ts`, `src/pipeline/phase5-synthesis.ts`, `src/ai/prompts.ts` - injection
- `context-builder/output/db-writer.ts` - respect `locked`
- `skills/read_context.ts`, `skills/revise_context.ts`, `skills/revert_context_revision.ts`
- `dashboard/src/routes/chat/` + `dashboard/src/routes/api/chat/` - the UI
- `dashboard/src/routes/context-builder/` - corrections list with revert

## Deliberately not built

- **No document rewriting.** Not now, not behind a flag. If the correction layer ever grows too
  large to inject, the fix is for the next Context Builder run to *consume* corrections as an
  input to synthesis - the layer becomes a source, and the harvest is still not edited in place.
- **No auto-detection of wrong facts.** Corrections come from the user, in conversation.
