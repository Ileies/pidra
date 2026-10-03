# Skills

Skills are TypeScript modules in `skills/`. Each is imported and registered explicitly in `src/skills/loader.ts`, so adding one means a new file plus an entry there (and, to make it usable from the assistant, a place in `SURFACES` in `src/ai/surfaces.ts`). The REST bridge that executes them listens on `127.0.0.1:4000` (`SKILLS_BRIDGE_PORT`/`SKILLS_BRIDGE_HOST`) and is never internet-exposed.

## Risk levels

| Level | Behaviour in `executeSkill()` |
|---|---|
| `low` | Runs immediately. |
| `medium` | Runs immediately, with a prominent log line. |
| `high` | Inserted as `pending` in `skill_executions`; runs only after manual confirmation on `/skills`. |
| `critical` | Always rejected. Blocked on the design work in `docs/todo/later.md`. |

No `high` or `critical` skill exists yet.

## Registry

| Risk | Skills |
|---|---|
| low | `write_note`, `update_note`, `delete_note`, `restore_note`, `list_notes`, `read_report`, `run_web_search`, `list_todo_items`, `add_todo_item`, `complete_todo_item`, `list_calendar_events`, `get_calendar_event`, `add_calendar_event`, `read_context`, `list_questions`, `create_question` |
| medium | `revise_context`, `revert_context_revision`, `remove_context_item`, `add_contact`, `set_source_active`, `propose_prompt_version`, `update_calendar_event`, `delete_calendar_event`, `update_todo_item`, `delete_todo_item`, `create_file`, `send_email`, `send_mail`, `open_project_in_editor` |

30 skills. Only four are kept off the assistant, as `BRIDGE_ONLY_SKILLS` in `src/ai/surfaces.ts`, reachable through the bridge alone: `create_file`, `send_email`, `send_mail`, `open_project_in_editor`. Every other skill is on at least one surface, and `EVERYWHERE_SKILLS` (context, report and web reads, notes list and write, all calendar, to-do and question skills) is on all of them; a page adds its own skills on top. `update_calendar_event` is therefore available to the chat, which finds the event id with `list_calendar_events` first.

## Default state

A skill is on until the owner switches it off on `/skills`. A skill that sends something outside the system sets `default_enabled: false` on the `Skill` interface and ships off: `send_email` and `send_mail` are the two. The owner turns them on from `/skills` if they accept the risk.

The state lives in two tables, resolved in `src/skills/overrides.ts`: a skill that is on by default is enabled unless it has a `disabled_skills` row; a skill that is off by default is enabled only if it has an `enabled_skills` row. `EffectiveSkill` reports `default_enabled` next to `enabled`. The dashboard's offline fallback catalog (`dashboard/src/routes/skills/catalog.ts`) marks the two mail skills `enabled: false` to match.

## Parameters

A skill takes optional parameters with defaults that keep the old call working, so the model can steer a call (a time window, a result limit, attendees, reminders, a search freshness) without the plain call changing. The shared parsers for Google calls (`intParam`, `boolParam`, `emailList`, `sendUpdatesParam`, `assertExpectedTitle`, `reminderOverrides`) live in `src/ingest/google.ts`; the mail skills share `src/skills/mail-options.ts`.

- `list_calendar_events` defaults to today plus 14 days; `add_calendar_event` defaults to a 60-minute event when `end` is omitted; `update_calendar_event` given a new start alone keeps the event's length.
- `send_updates` defaults to none, so adding or changing `attendees` does not mail guests unless asked.
- `update_calendar_event`, `delete_calendar_event`, `update_todo_item`, `delete_todo_item` and `complete_todo_item` take an `expected_title` guard: the call fails if the item at that id has a different title, so a wrong id cannot hit the wrong item.
- Adding a skill also means a place in `EVERYWHERE_SKILLS`, a page's list in `SURFACES`, or `BRIDGE_ONLY_SKILLS`; `scripts/check-route-surfaces.ts` fails the build otherwise.

## Execution

All skill calls (REST bridge, pipeline, chat, quick actions) go through `executeSkill()` in `src/skills/execute.ts`. It owns, in order:

1. the `skill_executions` audit row;
2. the enabled check (a skill disabled on `/skills` is rejected);
3. the surface policy, when the caller supplies a surface (see `docs/architecture-rules.md`, "The assistant's capabilities are per page"); a rejection is logged, not swallowed;
4. the risk gating above.

Never call `skill.execute()` directly from a new caller.

`Skill.execute(params, ctx)` receives a `SkillContext`: the `skill_executions` row id, who triggered it, the conversation, and the actor (`user | chat | system`) a write is attributed to. That is what puts provenance on a `note_revisions` or `context_corrections` row without the chat injecting parameters.

The `/chat` loop (`src/ai/chat/`) builds its tools from the registry filtered by the page's surface, so the model is only offered skills that are enabled and allowed on that page.
