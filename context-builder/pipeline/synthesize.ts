import type { ContactProfile } from "./batch-contacts";
import type { NoteExtraction } from "./extract-note";
import type { TaskItem } from "../sources/tasks";
import type { GitHubRepo } from "../sources/github";
import { synthesize as aiSynthesize } from "../../src/ai/openai";
import { addSonnetTokens } from "../progress";

// `max_output_tokens` on the Responses API covers reasoning tokens too, so every cap here sits
// well above the prose budget stated in the corresponding prompt.
function call(
  system: string,
  user: string,
  opts: { maxOutputTokens: number; effort: "low" | "medium" },
): Promise<string> {
  return aiSynthesize(system, user, {
    maxOutputTokens: opts.maxOutputTokens,
    reasoningEffort: opts.effort,
    onUsage: addSonnetTokens,
  }).then((r) => r.text);
}

export async function synthesizeContacts(contacts: ContactProfile[]): Promise<string> {
  const top = contacts.slice(0, 120);
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
    `You are building a contact directory for a personal briefing system. Given email interaction data, write a thorough contact profile summary.
Format: for each high- and medium-importance contact, one line: "Name <email>: relationship/role, key topics".
List low-importance contacts compactly at the end, grouped by what they appear to be (services, one-off senders, institutions).
Be specific and factual - no guessing, and do not invent relationships the data does not show.
Do not omit a contact just to be brief: completeness matters more than length here.`,
    input,
    { maxOutputTokens: 12000, effort: "low" },
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
    { maxOutputTokens: 3000, effort: "low" },
  );
}

export async function synthesizeKeep(notesByCategory: Map<string, NoteExtraction[]>): Promise<string> {
  // Title and excerpt go in alongside the model's own summary: these are the user's own words
  // about themselves and are the richest signal in the whole build.
  const input: Record<string, { title: string; summary: string; excerpt: string; type: string; importance: string }[]> = {};
  for (const [cat, notes] of notesByCategory) {
    input[cat] = notes.map((n) => ({
      title: n.title,
      summary: n.summary,
      excerpt: n.rawText,
      type: n.type,
      importance: n.importance,
    }));
  }

  return call(
    `Summarize these Google Keep notes into a thorough personal knowledge overview.
Group by category. For each category: the main themes, standing rules, recurring reminders, and important references.
Preserve concrete specifics - names, places, goals, dates, preferences, opinions and personal history.
These are the user's own notes about their own life: err strongly on the side of retaining detail
rather than generalising it away. A later system reads only this summary, never the raw notes.
Format as readable plain text. Flag any high-importance rules that should always be kept in context.`,
    JSON.stringify(input),
    { maxOutputTokens: 16000, effort: "low" },
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
    { maxOutputTokens: 3000, effort: "low" },
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

Write in second person ("You are..."). Be specific and factual.
Be thorough and extensive - this is the system's only long-term memory of who the user is, and
it is assembled once. Carry through concrete detail from the source summaries: names and
relationships, project names, goals and deadlines, habits, preferences, opinions, personal
history and background. Do not compress detail away for the sake of brevity, and do not add
anything the source summaries do not support.
This document will be injected into daily briefings to personalize them.`,
    JSON.stringify(parts),
    { maxOutputTokens: 24000, effort: "medium" },
  );
}

export async function synthesizePatch(existingContext: string, deltaSummaries: Partial<Omit<SynthesisResult, "fullContext">>, counts: { existing: number; delta: number }): Promise<string> {
  return call(
    `Update this existing personal context document with new information from the delta summaries.

The existing context reflects ${counts.existing} previously indexed items.
The delta contains ${counts.delta} new items. Merge proportionally - do not alter conclusions
drawn from the existing context unless directly contradicted by the delta.
Add new contacts and entities if present. Do not shrink the document.`,
    JSON.stringify({ existing_context: existingContext, delta: deltaSummaries }),
    { maxOutputTokens: 24000, effort: "medium" },
  );
}
