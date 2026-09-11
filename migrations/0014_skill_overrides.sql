CREATE TABLE "skill_overrides" (
  "skill_name" text PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT true,
  "risk_level_override" text,
  "description_override" text,
  "parameter_description_overrides" jsonb,
  "updated_at" timestamp with time zone DEFAULT now()
);
