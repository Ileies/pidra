-- Skills that are off by default (the mail skills) need a record of the owner turning them on.
-- A row means enabled from /skills; no row means the skill stays off. `disabled_skills` keeps
-- covering every skill that is on by default.
CREATE TABLE IF NOT EXISTS "enabled_skills" (
  "skill_name" text PRIMARY KEY NOT NULL,
  "enabled_at" timestamp with time zone DEFAULT now()
);
