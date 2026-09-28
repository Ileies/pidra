---
name: commit
description: PIDRA-specific commit workflow. Runs the project's check directly, then delegates doc-sync and the actual commit to a restricted subagent that already knows why the changes were made, instead of re-deriving it from a bare diff. Use whenever this session's work in this repo is ready to commit - the user asking is one trigger, but the assistant should invoke this itself whenever it decides a commit is warranted here, instead of ever running `git commit` directly.
---

# /commit - PIDRA's commit workflow

This exists because this repo's docs (`CLAUDE.md`, `docs/**`) are meant to stay in sync with the code, and because re-deriving "why did we change this" from a bare diff wastes tokens and produces worse commit messages than just asking the session that made the change. It replaces the generic commit flow in this repo only - other repos still use the normal one.

**Args:** free text from the invoking session summarizing *why* this session's changes were made - not what changed (the diff shows that), the reasoning/decisions behind it. If the session gives no args, ask for one sentence before proceeding; don't guess.

## Step 1 - gather state (predefined commands, run directly, no agent)

Run these yourself, in this order, and don't substitute or add exploratory commands:

```
git status --short
git diff --stat
git diff --name-only
```

Compare the file list against what you (the invoking session) actually edited this conversation. Per this repo's own git safety rule: never include pre-existing uncommitted changes that predate this session. If `git status` shows files you didn't touch, exclude them from everything below and note it in your final report to the user - don't ask the subagent to reason about files it wasn't told about.

## Step 2 - the check (predefined command, run directly, no agent)

Run:

```
bun run check
```

This one command already covers the TS check, the skill-write guard, the route-surface guard, and the dashboard's own check (including the offline blackhole suite) - see `package.json`'s `check` script. Don't run a narrower subset and don't run it twice.

**If it fails: stop here.** Report the failing step and its exact output back to the user. Do not invoke the subagent, do not stage anything, do not attempt a fix yourself - this skill prepares commits, it does not debug. The user decides what to do about a failing check.

## Step 3 - delegate doc-sync and the commit itself

Only reached if Step 2 passed. Invoke the `docs-committer` subagent (`Agent` tool, `subagent_type: "docs-committer"`) with a single self-contained prompt containing:

- The reason given in this skill's args (or gathered in Step 1 if none were given).
- The real `git diff` text for exactly the session's own files from Step 1 (restrict it with `git diff -- <file> <file> ...`, not a description of the diff) - handing over the actual text is still cheaper than letting the subagent explore to reconstruct it.
- The current list of files under `docs/**` (a plain `find docs -name '*.md'` is enough - don't have the subagent discover this itself).
- A reminder that it must not explore the codebase beyond what's given, must not touch non-doc files, must not fix anything, and must not re-run checks (already done in Step 2). It may still run `git status`/`diff`/`log` freely for its own orientation and for the clean-tree check after committing - that's expected, not exploration - it just must never treat something one of those turns up as a new file to act on beyond what this prompt names.

Do not add anything else to that prompt - the subagent's own definition (`.claude/agents/docs-committer.md`) carries the rest of its instructions, and repeating them here wastes tokens on every invocation.

## Step 4 - relay the result

The subagent reports back what docs it changed (if any) and the commit(s) it made. Relay that summary to the user in your own voice - don't just paste its report verbatim, and don't re-verify its work with your own `git log`/`git diff` unless the user asks or the subagent's report looks inconsistent with what you know of this session.
