-- Editable notes and page-aware chat. Applied manually (drizzle-kit migrate hangs here);
-- this file is the reference copy.

-- Notes become mutable and reversible. Every consumer must filter `deleted_at IS NULL`.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS notes_active_idx
  ON notes (scope, created_at DESC) WHERE deleted_at IS NULL;

-- Append-only history holding the state *before* each change.
CREATE TABLE IF NOT EXISTS note_revisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id             uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  operation           text NOT NULL,          -- update | delete | restore
  previous_content    text,
  previous_scope      text,
  previous_expires_at date,
  changed_by          text NOT NULL,          -- user | chat | system
  skill_execution_id  uuid REFERENCES skill_executions(id) ON DELETE SET NULL,
  conversation_id     uuid REFERENCES chat_conversations(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_revisions_note_idx
  ON note_revisions (note_id, created_at DESC);

-- Which page a conversation started on, and what the assistant saw on each turn.
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS surface text;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS page_context jsonb;
