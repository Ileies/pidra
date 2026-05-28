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

**Important: app passwords do not work.** Google's Android auth endpoint (`gpsoauth`) returns `BadAuthentication` for all accounts as of 2025, even with a valid app password and 2FA enabled. The only working path is a browser cookie exchange:

1. Open `https://accounts.google.com/EmbeddedSetup` in a browser while logged into the Google account.
2. Click "I agree". The page appears to hang - this is normal.
3. Open DevTools - Application - Cookies - `accounts.google.com`.
4. Find the cookie named `oauth_token` (value starts with `oauth2_4/...`).
5. Paste it into the prompt when the script asks for it.

The script exchanges the cookie for a long-lived master token (`aas_et/...`) via `gpsoauth.exchange_token`, verifies it against gkeepapi, saves it to `context-builder/.keep-token.json`, and prints the line to add to `.env`:

```
GKEEPAPI_MASTER_TOKEN=aas_et/...
```

The master token does not expire. You only need to repeat this if it gets revoked.

**Why a proper OAuth2 flow is not possible:** Google Keep has no public API. The scopes gkeepapi uses (`memento`, `reminders`) are internal Android/GMS scopes that do not appear in Google's OAuth2 scope registry for third-party apps - you cannot request them in a consent screen. Calendar and Tasks work via standard OAuth2 because they have official APIs; Keep does not. The EmbeddedSetup cookie method is the least hacky option available.

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
