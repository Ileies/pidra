// Synthesis prompts and model calls (via src/ai/openai.ts): four source summaries plus the final
// document, either built in full or as a patch of the previous one. Called only by phases/synthesize.ts.
// Both document prompts embed DOCUMENT_STRUCTURE, the `# 1.`-`# 5.` contract checked by missingSections.
import type { ContactProfile } from "./batch-contacts";
import type { NoteExtraction } from "./extract-note";
import type { TaskItem } from "../sources/tasks";
import type { GitHubRepo } from "../sources/github";
import { synthesize as aiSynthesize } from "../../src/ai/openai";
import type { formatForPrompt } from "../../src/context/corrections";
import { addSonnetTokens } from "../progress";

/** Active corrections in the shape the daily prompts already use: `{about, operation, correct, incorrect}`. */
export type PromptCorrections = ReturnType<typeof formatForPrompt>;

/**
 * Prompt block telling the model that user corrections outrank every other input. Needed because a
 * rebuild re-reads the sources that caused the mistake and a patch receives the previous (wrong)
 * text verbatim. Corrections are read-only here.
 */
const CORRECTIONS_RULES = `context_corrections are corrections the user made to an earlier version of this document,
stated by them directly. They outrank every other input here, without exception:
- "correct" is fact. Write the document as if it had always said that.
- "incorrect", where present, is the wrong text quoted from the earlier document. Do not carry
  it forward and do not mention that it was ever believed. Drop it.
- operation is amend (the old statement is wrong), complement (it is merely incomplete) or
  retract (it states something false that should simply be gone).
- No source summary can outweigh a correction. Where one implies otherwise, the correction wins
  and the conflicting detail is left out.
- They are read-only background. Never list them, never mention that corrections exist, and
  never add a section about them: the document reads as one coherent profile.
- If the list is empty, proceed exactly as you would without it.`;

/**
 * The document's heading contract, shared by the full build and the update patch. INTERFACE, not
 * formatting: `pickSections` (src/pipeline/long-term-context.ts) splits on `# N.` headings to route
 * sections to the daily synthesis calls, and REQUIRED_SECTIONS in run-tracking.ts checks the same
 * five numbers. Change all three together. (2026-09-11: a patch answered with a single title over
 * "## 1." headings, the split matched nothing and briefings ran on an empty document.)
 */
const DOCUMENT_STRUCTURE = `Structure it as exactly these five top-level sections, each introduced by a level-1 heading
that starts with the section number and a dot:

# 1. Identity & Relationships (key contacts, roles, relationships)
# 2. Active Projects & Commitments (ongoing work, open tasks, deadlines)
# 3. Knowledge Domains & Interests (main areas of expertise and curiosity)
# 4. Standing Context (rules, habits, recurring commitments from Keep notes)
# 5. Technical Profile (languages, tools, repos)

These headings are parsed downstream, so they are not a suggestion: write all five, keep the
numbering, and use no other level-1 heading anywhere in the document. Sub-headings inside a
section are free-form ("## ..." and deeper). Do not add a title above section 1, do not merge,
rename, reorder or drop a section, and do not emit a section that only says what changed.`;

// `max_output_tokens` on the Responses API covers reasoning tokens too, so every cap here sits
// well above the prose budget stated in the corresponding prompt.
function call(
  system: string,
  user: string,
  opts: { maxOutputTokens: number; effort: "low" | "medium" | "high" },
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
    { maxOutputTokens: 18000, effort: "medium" },
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
    { maxOutputTokens: 4500, effort: "medium" },
  );
}

export async function synthesizeKeep(notesByCategory: Map<string, NoteExtraction[]>): Promise<string> {
  // Raw title and excerpt accompany the extraction summary: the user's own words are the richest signal.
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
    { maxOutputTokens: 24000, effort: "medium" },
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
    { maxOutputTokens: 4500, effort: "medium" },
  );
}

export interface SynthesisResult {
  contacts: string;
  tasks: string;
  keep: string;
  github: string;
  fullContext: string;
}

/** Builds the whole document from the four summaries; the output is not validated here (phases/synthesize.ts does that). */
export async function synthesizeFullContext(
  parts: Omit<SynthesisResult, "fullContext">,
  corrections: PromptCorrections = [],
): Promise<string> {
  return call(
    `You are building a long-term personal context document for a morning briefing AI system.
Given structured summaries from multiple data sources, produce a coherent context document.

${DOCUMENT_STRUCTURE}

Write in second person ("You are..."). Be specific and factual.
Be thorough and extensive - this is the system's only long-term memory of who the user is, and
it is assembled once. Carry through concrete detail from the source summaries: names and
relationships, project names, goals and deadlines, habits, preferences, opinions, personal
history and background. Do not compress detail away for the sake of brevity, and do not add
anything the source summaries do not support.
This document will be injected into daily briefings to personalize them.

${CORRECTIONS_RULES}`,
    JSON.stringify({ ...parts, context_corrections: corrections }),
    { maxOutputTokens: 32000, effort: "high" },
  );
}

/**
 * Update mode: returns the COMPLETE updated document (it replaces the previous one outright), not a
 * diff. `deltaSummaries` holds only sources fetched this run. Output is not validated here.
 */
export async function synthesizePatch(
  existingContext: string,
  deltaSummaries: Partial<Omit<SynthesisResult, "fullContext">>,
  counts: { existing: number; delta: number },
  corrections: PromptCorrections = [],
): Promise<string> {
  return call(
    `Update this existing personal context document with new information from the delta summaries.

Output the complete updated document, not a patch, a changelog or a summary of what changed.
It replaces the existing one, so anything you leave out is lost: carry every section, fact,
name and detail of existing_context forward verbatim unless the delta contradicts it.

${DOCUMENT_STRUCTURE}

The existing context reflects ${counts.existing} previously indexed items.
The delta contains ${counts.delta} new items. Merge proportionally - do not alter conclusions
drawn from the existing context unless directly contradicted by the delta.
Add new contacts and entities if present. Do not shrink the document.

The delta carries only the sources that produced something this run. A source that is absent
from it was not fetched, which says nothing about whether it still exists: never read a missing
source as a reason to shorten or remove the part of the document it fed.

${CORRECTIONS_RULES}

The existing_context below was written before these corrections were made, so it still contains
the text they correct. Where a correction and the existing context disagree, the existing
context is the one that is wrong.`,
    JSON.stringify({ existing_context: existingContext, delta: deltaSummaries, context_corrections: corrections }),
    { maxOutputTokens: 32000, effort: "high" },
  );
}
