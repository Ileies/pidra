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
| low | `write_note`, `update_note`, `delete_note`, `restore_note`, `list_notes`, `read_report`, `run_web_search`, `add_todo_item`, `complete_todo_item`, `add_calendar_event`, `read_context`, `list_questions`, `create_question` |
| medium | `revise_context`, `revert_context_revision`, `remove_context_item`, `add_contact`, `set_source_active`, `propose_prompt_version`, `update_calendar_event`, `create_file`, `send_email`, `send_mail`, `open_project_in_editor` |

Four skills are on no assistant surface and are reachable only through the bridge: `create_file`, `send_email`, `send_mail`, `open_project_in_editor`. `update_calendar_event` is also on no surface: it exists for the report's quick actions, which know the event id, and the assistant cannot look one up.

## Execution

All skill calls (REST bridge, pipeline, chat, quick actions) go through `executeSkill()` in `src/skills/execute.ts`. It owns, in order:

1. the `skill_executions` audit row;
2. the enabled check (a skill disabled on `/skills` is rejected);
3. the surface policy, when the caller supplies a surface (see `docs/architecture-rules.md`, "The assistant's capabilities are per page"); a rejection is logged, not swallowed;
4. the risk gating above.

Never call `skill.execute()` directly from a new caller.

`Skill.execute(params, ctx)` receives a `SkillContext`: the `skill_executions` row id, who triggered it, the conversation, and the actor (`user | chat | system`) a write is attributed to. That is what puts provenance on a `note_revisions` or `context_corrections` row without the chat injecting parameters.

The `/chat` loop (`src/ai/chat/`) builds its tools from the registry filtered by the page's surface, so the model is only offered skills that are enabled and allowed on that page.
