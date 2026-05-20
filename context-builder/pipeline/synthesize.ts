import OpenAI from "openai";
import type { ContactProfile } from "./batch-contacts";
import type { NoteExtraction } from "./extract-note";
import type { TaskItem } from "../sources/tasks";
import type { GitHubRepo } from "../sources/github";
import { addSonnetTokens } from "../progress";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-4o";

async function call(system: string, user: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    store: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 2000,
  });
  const tokIn = res.usage?.prompt_tokens ?? 0;
  const tokOut = res.usage?.completion_tokens ?? 0;
  addSonnetTokens(tokIn, tokOut);
  return res.choices[0].message.content ?? "";
}

export async function synthesizeContacts(contacts: ContactProfile[]): Promise<string> {
  const top = contacts.slice(0, 50);
  const input = JSON.stringify(top.map((c) => ({
    email: c.email,
    name: c.name,
    emails: c.emailCount,
    categories: c.categories,
    importance: c.importance,
    actions: c.actionCount,
    entities: c.entities,
  })));

  return call(
    `You are building a contact directory for a personal briefing system. Given email interaction data, write a concise contact profile summary (max 2000 tokens).
Format: for each high-importance contact, one line: "Name <email>: relationship/role, key topics".
Group medium-importance contacts together. Skip low-importance.
Be specific and factual — no guessing. Use only what the data shows.`,
    input,
  );
}

export async function synthesizeTasks(tasks: TaskItem[]): Promise<string> {
  const active = tasks.filter((t) => t.status === "needsAction");
  const recentDone = tasks.filter((t) => t.status === "completed").slice(0, 20);

  return call(
    `Summarize these Google Tasks into a concise active commitments overview (max 500 tokens).
List active tasks grouped by list, with due dates where present.
Note any patterns (overdue items, recurring task types, project clusters).
Format as readable plain text, not JSON.`,
    JSON.stringify({ active, recent_completions: recentDone }),
  );
}

export async function synthesizeKeep(notesByCategory: Map<string, NoteExtraction[]>): Promise<string> {
  const input: Record<string, { summary: string; type: string; importance: string }[]> = {};
  for (const [cat, notes] of notesByCategory) {
    input[cat] = notes.map((n) => ({ summary: n.summary, type: n.type, importance: n.importance }));
  }

  return call(
    `Summarize these Google Keep notes into a personal knowledge overview (max 800 tokens).
Group by category. For each category: what are the main themes? Are there standing rules, recurring reminders, or important references?
Format as readable plain text. Flag any high-importance rules that should always be kept in context.`,
    JSON.stringify(input),
  );
}

export async function synthesizeGitHub(repos: GitHubRepo[]): Promise<string> {
  return call(
    `Summarize these GitHub repositories into a project portfolio overview (max 600 tokens).
For each active repo (pushed in last 6 months): name, purpose (from description/README), primary language, recent activity direction.
Group stale repos briefly. Note main technical domains and skill areas.`,
    JSON.stringify(repos.map((r) => ({
      name: r.name,
      full_name: r.id,
      description: r.description,
      language: r.language,
      pushed_at: r.pushedAt,
      readme_excerpt: r.readme,
      recent_commits: r.recentCommits,
    }))),
  );
}

export interface SynthesisResult {
  contacts: string;
  tasks: string;
  keep: string;
  github: string;
  fullContext: string;
}

export async function synthesizeFullContext(parts: Omit<SynthesisResult, "fullContext">): Promise<string> {
  return call(
    `You are building a long-term personal context document for a morning briefing AI system.
Given structured summaries from multiple data sources, produce a coherent context document.

Structure it as:
1. Identity & Relationships (key contacts, roles, relationships)
2. Active Projects & Commitments (ongoing work, open tasks, deadlines)
3. Knowledge Domains & Interests (main areas of expertise and curiosity)
4. Standing Context (rules, habits, recurring commitments from Keep notes)
5. Technical Profile (languages, tools, repos)

Write in second person ("You are..."). Be specific and factual. Max 2500 tokens.
This document will be injected into daily briefings to personalize them.`,
    JSON.stringify(parts),
  );
}

export async function synthesizePatch(existingContext: string, deltaSummaries: Partial<Omit<SynthesisResult, "fullContext">>, counts: { existing: number; delta: number }): Promise<string> {
  return call(
    `Update this existing personal context document with new information from the delta summaries.

The existing context reflects ${counts.existing} previously indexed items.
The delta contains ${counts.delta} new items. Merge proportionally — do not alter conclusions
drawn from the existing context unless directly contradicted by the delta.
Add new contacts and entities if present. Do not shrink the document.`,
    JSON.stringify({ existing_context: existingContext, delta: deltaSummaries }),
  );
}
