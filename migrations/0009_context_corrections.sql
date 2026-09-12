-- Correction layer over the harvested long-term context, plus the chat that produces it.
-- Append-only: harvested information is never overwritten, only adjusted and complemented.

CREATE TABLE IF NOT EXISTS context_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind text NOT NULL,
  target_key text NOT NULL,
  operation text NOT NULL,
  statement text NOT NULL,
  supersedes_text text,
  rationale text,
  previous_state jsonb,
  source text NOT NULL DEFAULT 'chat',
  status text NOT NULL DEFAULT 'active',
  conversation_id uuid,
  created_at timestamptz DEFAULT now(),
  reverted_at timestamptz
);

-- Every daily run reads the active corrections; nothing reads the reverted ones in bulk.
CREATE INDEX IF NOT EXISTS context_corrections_active
  ON context_corrections (created_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS context_corrections_target
  ON context_corrections (target_kind, target_key);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  tool_calls jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation
  ON chat_messages (conversation_id, created_at);

-- A corrected row must survive a Context Builder re-seed.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false;
