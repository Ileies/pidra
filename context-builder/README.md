# Context Builder

Scans personal data sources (email, Google Keep, Google Tasks, GitHub), compresses each item into structured JSON and synthesises a long-term context document. Seeds `entities`, `contacts` and `standing_context`. How it works, the run modes and the document contract are in [`docs/context-builder.md`](../docs/context-builder.md); this file covers setup, commands and recovery.

It runs by hand for a full harvest, and by itself in update mode on the 1st of each month at 03:00 as the `pidra-context-builder` systemd job (`hosts/pronix/pidra.nix`). The harvest is stored in `context_builder_runs.document`, so it does not matter which machine ran it; only `.checkpoint.json`, `errors.json` and the archival JSON/MD files stay local to that machine.

## Prerequisites

- `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL_EXTRACTION` and `OPENAI_MODEL_SYNTHESIS` select the models (default `gpt-6-luna`).
- Database migrated (`migrations/`); the harvest tables are `context_builder_runs` and `context_builder_indexed_items`.
- Google OAuth credentials in `.env`, shared with the main pipeline.
- `GITHUB_TOKEN` in `.env` (PAT with `repo` scope). Falls back to `gh auth token`; without either, GitHub contributes nothing.
- `GKEEPAPI_MASTER_TOKEN` in `.env` (see below).

Optional tuning: `CONTEXT_BUILDER_EMAIL_YEARS` (lookback, default 3), `CONTEXT_BUILDER_EXTRACT_CONCURRENCY` (default 8), `CONTEXT_BUILDER_MAX_RSS_MB` (memory watchdog, default 4096), `CONTEXT_BUILDER_OUTPUT_DIR`.

## Excluded Keep labels

Keep notes labelled with anything in `CONTEXT_BUILDER_KEEP_EXCLUDE_LABELS` (comma-separated, default `Credentials`) are dropped inside `sources/keep.ts`, at the fetch choke point, so no consumer can bypass it. Every run prints how many notes were withheld. The rule itself is in `docs/architecture-rules.md`.

## One-time: Google Keep auth

gkeepapi is not packaged in nixpkgs. It needs a persistent venv at `context-builder/.venv`, which `sources/keep.ts` looks for at runtime (otherwise it falls back to system `python3`, which lacks the package):

```sh
python3 -m venv context-builder/.venv
context-builder/.venv/bin/pip install gkeepapi -q
context-builder/.venv/bin/python3 context-builder/scripts/keep-auth.py
```

**The server needs the venv too**, or the monthly run fetches zero notes: `fetchKeepNotes` logs the failure and returns an empty list instead of throwing. It lives at `/var/www/pidra/context-builder/.venv` and is gitignored, so `git pull` never touches it. The auth step is not repeated there: copy `GKEEPAPI_MASTER_TOKEN` into the server's `.env`. The interpreter comes from `pkgs.python3`, declared in `pidra.nix` so a garbage collection cannot strip the venv's symlink target.

**App passwords do not work.** Google's Android auth endpoint (`gpsoauth`) returns `BadAuthentication` for them even with 2FA. The only working path is a browser cookie exchange:

1. Open `https://accounts.google.com/EmbeddedSetup` while logged into the Google account.
2. Click "I agree". The page appears to hang; that is normal.
3. In DevTools, open Application, Cookies, `accounts.google.com`, and copy the `oauth_token` cookie (starts with `oauth2_4/`).
4. Paste it when the script asks.

The script exchanges the cookie for a long-lived master token (`aas_et/...`) via `gpsoauth.exchange_token`, verifies it against gkeepapi, saves it to `context-builder/.keep-token.json` and prints the `.env` line:

```
GKEEPAPI_MASTER_TOKEN=aas_et/...
```

The token does not expire; repeat this only if it is revoked. A proper OAuth2 flow is not possible: Keep has no public API, and the scopes gkeepapi uses (`memento`, `reminders`) are internal Android scopes that cannot be requested in a consent screen.

## Running

```sh
bun run context-builder                          # auto: full on the first run, update after
bun run context-builder:full                     # force a full rebuild
bun run context-builder:dry                      # inventory counts only; no API calls, no writes
bun run context-builder/run.ts --update          # force update (delta) mode
bun run context-builder/run.ts --from-index      # redo synthesis, output and seeding from stored extractions
bun run context-builder/run.ts --seed-only       # re-seed contacts/entities/standing_context only
```

`--from-index` and `--seed-only` make no fetch and no extraction calls. `--from-index` is the recovery path when extraction succeeded but something downstream did not; it is far cheaper than a rebuild. Mode semantics are in `docs/context-builder.md`.

When the database is not on the LAN, tunnel first:

```sh
ssh -N -L 15432:127.0.0.1:5432 ros
DATABASE_URL=postgresql://postgres@127.0.0.1:15432/pidra bun run context-builder
```

## Output

- `output/context-YYYY-MM-DD.json` and `.md`: archival copies (the JSON also keeps the four source summaries). Nothing reads them except legacy rows without a `document`.
- Database: the three seeded tables, and the document on `context_builder_runs.document`.

## Error handling and recovery

Failed items are logged to `errors.json` and skipped; a failed source phase does not abort the run. `errors.json` accumulates across runs, so check the `ts` field before blaming a run for an error. An interrupted run (Ctrl+C) resumes from the checkpoint when restarted without flags.

The three seed targets are written independently. Model output is stripped of control characters before it reaches Postgres: a NUL byte in one entity name once failed a whole batch insert and silently left `standing_context` empty on a run that reported success.

## Runtime

The run is IMAP-bound, not model-bound: bodies are fetched one message at a time per account (a few seconds each, accounts in parallel), while extraction runs `CONTEXT_BUILDER_EXTRACT_CONCURRENCY` calls at once. Expect roughly an hour for a full run over a few thousand items and a few minutes for a typical monthly update. Under systemd there is no terminal, so the live display becomes one `[progress]` line per state change: `journalctl -u pidra-context-builder`.
