# Now

See `docs/todo/README.md` for the conventions this list follows.

- **[DECISION]** `send_email`, `create_file` and `open_project_in_editor` (`BRIDGE_ONLY_SKILLS`, on no assistant surface) have no caller since `POST /skills/execute` was removed. Owner to decide: remove the three skills plus `BRIDGE_ONLY_SKILLS` and `src/skills/mail-options.ts`, or keep them for a future caller.
