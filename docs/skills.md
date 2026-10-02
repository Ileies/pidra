# Skills

Skills are TypeScript modules in `/skills/`, auto-discovered on server start. The bridge runs on `localhost:4000` (never internet-exposed).

Risk levels:
- `low` - auto-execute immediately
- `medium` - execute with prominent log entry
- `high` - inserted as `pending` in `skill_executions`, requires manual confirmation
- `critical` - always rejected; never auto-execute (blocked on the design work in `docs/todo/later.md`)

Current skills: `write_note`, `update_note`, `delete_note`, `restore_note`, `list_notes`, `read_report`, `run_web_search`, `add_todo_item`, `complete_todo_item`, `add_calendar_event`, `read_context`, `list_questions`, `create_question` (all low), `create_file`, `send_email`, `send_mail`, `revise_context`, `revert_context_revision`, `remove_context_item`, `add_contact`, `set_source_active`, `propose_prompt_version`, `open_project_in_editor`, `update_calendar_event` (all medium). `update_calendar_event` is on no surface: it exists for the quick actions, which know the event id, and the assistant cannot look one up.

All skill calls - from the REST bridge, the pipeline and the chat alike - go through `executeSkill()` in `src/skills/execute.ts`, which owns the risk gating, the surface policy (see `docs/architecture-rules.md`, "The assistant's capabilities are per page") and the `skill_executions` audit log. Never call `skill.execute()` directly from a new caller.

`Skill.execute(params, ctx)` receives a `SkillContext`: the `skill_executions` row id, who triggered it, the conversation, and the actor (`user | chat | system`) a write is attributed to. That is what puts provenance on a `note_revisions` row or a `context_corrections` row without the chat having to inject parameters.

The `/chat` loop (`src/ai/chat/`) exposes the whole registry as tools automatically, so a new skill in `skills/` is usable from the chat with no change there.
