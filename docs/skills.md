# Skills

Skills are TypeScript modules in `skills/`. Each is imported and registered explicitly in `src/skills/loader.ts`, so adding one means a new file plus an entry there (and, to make it usable from the assistant, a place in `SURFACES` in `src/ai/surfaces.ts`). The REST bridge that executes them listens on `127.0.0.1:4000` (`SKILLS_BRIDGE_PORT`/`SKILLS_BRIDGE_HOST`) and is never internet-exposed.

## Risk levels

| Level | Behaviour in `executeSkill()` |
|---|---|
| `low` | Runs immediately. |
| `medium` | Runs immediately, with a prominent log line. |
| `high` | Inserted as `pending` in `skill_executions`; runs only after manual confirmation on `/skills`. |
| `critical` | Always rejected. Blocked on the design work in `docs/todo/later.md`. |

No `critical` skill exists yet.

## Registry

The skills themselves are the files in `skills/`, registered in `src/skills/loader.ts`; each declares its own risk level. Only `send_email` and `propose_prompt_version` are `high`. Every skill is on at least one assistant surface. `INTERACTIVE_SKILLS` in `src/ai/surfaces.ts` (`send_email`, `create_file`) are on every surface except `questions`, whose turns run unattended on untrusted mail text. `EVERYWHERE_SKILLS` (context, report and web reads, notes list and write, all calendar, to-do and question skills) is on all of them; a page adds its own skills on top. `update_calendar_event` is therefore available to the chat, which finds the event id with `list_calendar_events` first.

## Default state

A skill is on until the owner switches it off on `/skills`. The outbound `send_email` skill sets `default_enabled: false` and ships off. The owner turns it on from `/skills`; each call then waits for manual confirmation because its risk level is high.

The state lives in two tables, resolved in `src/skills/overrides.ts`: a skill that is on by default is enabled unless it has a `disabled_skills` row; a skill that is off by default is enabled only if it has an `enabled_skills` row. `EffectiveSkill` reports `default_enabled` next to `enabled`. The dashboard's offline fallback catalog (`dashboard/src/routes/skills/catalog.ts`) marks `send_email` `enabled: false` to match.

## Parameters

A skill takes optional parameters with defaults that keep the old call working, so the model can steer a call (a time window, a result limit, attendees, reminders, a search freshness) without the plain call changing. The shared parsers for Google calls (`intParam`, `boolParam`, `emailList`, `sendUpdatesParam`, `assertExpectedTitle`, `reminderOverrides`) live in `src/ingest/google.ts`; `send_email` uses `src/skills/mail-options.ts` for mail options. Its optional `account` selects a configured sender or alias; without it, the skill uses the system account and checks every destination against `ALLOWED_EMAIL_RECIPIENTS`, which is empty by default.

- `list_calendar_events` defaults to today plus 14 days; `add_calendar_event` defaults to a 60-minute event when `end` is omitted; `update_calendar_event` given a new start alone keeps the event's length.
- `send_updates` defaults to none, so adding or changing `attendees` does not mail guests unless asked.
- `update_calendar_event`, `delete_calendar_event`, `update_todo_item`, `delete_todo_item` and `complete_todo_item` take an `expected_title` guard: the call fails if the item at that id has a different title, so a wrong id cannot hit the wrong item.
- Adding a skill also means a place in `EVERYWHERE_SKILLS`, a page's list in `SURFACES`, or `INTERACTIVE_SKILLS`; `scripts/check-route-surfaces.ts` fails the build otherwise.

## Execution

All skill calls (REST bridge, pipeline, chat, quick actions) go through `executeSkill()` in `src/skills/execute.ts`. It owns, in order:

1. the `skill_executions` audit row;
2. the enabled check (a skill disabled on `/skills` is rejected);
3. the surface policy, when the caller supplies a surface (see `docs/architecture-rules.md`, "The assistant's capabilities are per page"); a rejection is logged, not swallowed;
4. the risk gating above.

Never call `skill.execute()` directly from a new caller.

`Skill.execute(params, ctx)` receives a `SkillContext`: the `skill_executions` row id, who triggered it, the conversation, and the actor (`user | chat | system`) a write is attributed to, and `timeZone`. The actor is what puts provenance on a `note_revisions` or `context_corrections` row without the chat injecting parameters. `timeZone` is the zone the calendar skills read an offset-less time in: chat sends the browser's zone in the turn context (validated, UTC when missing or invalid) and `executeSkill()` passes it through `ExecutionOptions.timeZone`; every other caller gets UTC.

The `/chat` loop (`src/ai/chat/`) builds its tools from the registry filtered by the page's surface, so the model is only offered skills that are enabled and allowed on that page.
