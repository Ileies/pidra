# Context Builder

One-shot tool that scans all personal data sources (email, Google Keep, Google Tasks, GitHub), compresses each item into structured JSON, and synthesizes a long-term context document. Seeds PIDRA's `entities`, `contacts`, and `standing_context` tables.

Both stages call `gpt-5.6-luna` through `src/ai/openai.ts` on the `flex` service tier with `store: false`. Extraction uses strict JSON schemas, so the model cannot return malformed or drifting fields. The local Ollama path was removed: the 9B model truncated its own JSON mid-object and hit 90 s timeouts often enough that runs never completed.

## Prerequisites

- `OPENAI_API_KEY` in `.env`
- DB migration 0007 applied (tables: `context_builder_runs`, `context_builder_indexed_items`, `standing_context`)
- Google OAuth credentials in `.env` (same as main pipeline)
- `GITHUB_TOKEN` in `.env` (PAT with `repo` scope) - falls back to `gh auth token` if unset
- `GKEEPAPI_MASTER_TOKEN` in `.env` (see Keep setup below)

## Data that never leaves the machine

Keep notes carrying a label listed in `CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS` (default: `Credentials`) are dropped inside `sources/keep.ts`, before any consumer sees them - passwords, card and bank details, and identity-document numbers are never sent to an API. The filter sits at the fetch choke point rather than in the extractor so that a future consumer cannot bypass it. Every run prints how many notes were withheld.

## One-time: Google Keep auth

gkeepapi is not packaged in nixpkgs. It needs a persistent venv at `context-builder/.venv` - `keep.ts` looks for it there at runtime (falls back to system `python3`, which won't have the package):

```sh
python3 -m venv context-builder/.venv
context-builder/.venv/bin/pip install gkeepapi -q
context-builder/.venv/bin/python3 context-builder/scripts/keep-auth.py
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

# Dry run - inventory count only; no API calls, no DB writes, no checkpoint changes
bun run context-builder:dry

# Force update/delta mode
bun run context-builder/run.ts --update

# Redo synthesis, output files and DB seeding from the stored extractions.
# No fetch and no extraction calls - a few dollars cheaper than a rebuild, and the right
# recovery path when extraction succeeded but something downstream of it did not.
bun run context-builder/run.ts --from-index

# Re-seed contacts/entities/standing_context only, from the stored extractions. No model calls.
bun run context-builder/run.ts --seed-only
```

When the DB is not on the LAN, tunnel first and point `DATABASE_URL` at the tunnel:

```sh
ssh -N -L 15432:127.0.0.1:5432 ros
DATABASE_URL=postgresql://postgres@127.0.0.1:15432/pidra bun run context-builder
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
| `dry-run` | `--dry-run` | Counts only, no extraction, no writes, no run-state changes |
| `from-index` | `--from-index` | Synthesis + output + seeding from stored extractions; no fetch, no extraction |
| `seed-only` | `--seed-only` | DB seeding from stored extractions; no fetch, no model calls |

## Error handling

Failed items are logged to `context-builder/errors.json` and skipped. A failed source phase does not abort the run - synthesis proceeds with whatever data is available. If the run is interrupted (Ctrl+C), restart it without flags to resume from the checkpoint.

`errors.json` is a persistent log across runs, not a per-run file: check the `ts` field before concluding that a given run produced a given error.

The three seed targets (`contacts`, `entities`, `standing_context`) are written independently, so a failure on one cannot skip the others. Model output is stripped of control characters before it reaches Postgres - a single entity name containing NUL bytes once failed an entire batch insert, which silently left `standing_context` empty on a run that reported success.

## Estimated runtime

Now IMAP-bound, not model-bound: bodies are fetched one message at a time per account, at roughly
2-3 s each, while extraction runs `CONTEXT_BUILDER_EXTRACT_CONCURRENCY` (default 8) calls in
parallel at ~0.6 s per item amortised.

- Full run, ~1800 mail headers + ~400 Keep notes: ~1 hour, almost all of it the mail fetch
- Update run with 50 new emails: 2-5 minutes

The obvious next speedup is fetching the accounts concurrently instead of sequentially in
`run.ts` - each account is a separate IMAP connection, so they do not contend.
