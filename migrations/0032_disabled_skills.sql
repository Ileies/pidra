DROP TABLE "skill_overrides";

CREATE TABLE "disabled_skills" (
  "skill_name" text PRIMARY KEY,
  "disabled_at" timestamp with time zone DEFAULT now()
);
