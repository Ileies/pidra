CREATE TABLE "question_gate_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"run_date" date NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb,
	"status" text DEFAULT 'pending',
	"timeout_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"answered_at" timestamp with time zone,
	CONSTRAINT "question_gate_sessions_run_id_unique" UNIQUE("run_id")
);
