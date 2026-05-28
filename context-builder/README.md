# Context Builder

One-shot tool that scans all personal data sources (email, Google Keep, Google Tasks, GitHub), compresses them locally with Ollama, and synthesizes a structured long-term context document via OpenAI. Seeds PIDRA's `entities`, `contacts`, and `standing_context` tables.

## Prerequisites

- Ollama running locally with `qwen2.5:14b` pulled
- DB migration 0007 applied (tables: `context_builder_runs`, `context_builder_indexed_items`, `standing_context`)
- Google OAuth credentials in `.env` (same as main pipeline)
- `GITHUB_TOKEN` in `.env` (PAT with `repo` scope)
- `GKEEPAPI_MASTER_TOKEN` in `.env` (see Keep setup below)

## One-time: Google Keep auth

gkeepapi is not packaged in nixpkgs, so install it via pip in a temporary venv:

```sh
nix shell nixpkgs#python3 nixpkgs#python3Packages.pip -c sh -c \
  "python3 -m venv /tmp/gkeep-venv && /tmp/gkeep-venv/bin/pip install gkeepapi -q && /tmp/gkeep-venv/bin/python3 context-builder/scripts/keep-auth.py"
```

You will need a Google App Password (generate one at myaccount.google.com/apppasswords). The token is saved to `context-builder/.keep-token.json` and used automatically by all subsequent runs.

## Running

```sh
# Auto-detect mode (full on first run, update on subsequent runs)
bun run context-builder

# Force full rebuild
bun run context-builder:full

# Dry run - count only, no Ollama, no API calls, no writes
bun run context-builder:dry

# Force update/delta mode
bun run context-builder/run.ts --update
```

## Output

- `context-builder/output/context-YYYY-MM-DD.json` - structured data
- `context-builder/output/context-YYYY-MM-DD.md` - human-readable snapshot
- DB: `contacts`, `entities`, `standing_context` tables seeded

## Modes

| Mode | When | What runs |
|---|---|---|
| `full` | First run or `--full` | All sources from scratch |
| `update` | Subsequent runs | New items only; GitHub + Tasks always re-fetched |
| `resume` | After interrupted run | Continues from checkpoint |
| `dry-run` | `--dry-run` | Counts only, no extraction, no writes |

## Error handling

Failed items are logged to `context-builder/errors.json` and skipped. A failed source phase does not abort the run - synthesis proceeds with whatever data is available. If the run is interrupted (Ctrl+C), restart it without flags to resume from the checkpoint.

## Estimated runtime

Full run with 2500 emails + 1000 Keep notes: 2-4 hours (Ollama bound).
Update run with 50 new emails: 5-15 minutes.
