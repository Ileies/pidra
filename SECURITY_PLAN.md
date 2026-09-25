# SECURITY_PLAN.md - PIDRA

Status: proposed, 2026-09-11. The public passkey gate and the phased security design are not implemented. The skills bridge already binds to loopback by default; see §6.

This document defines how PIDRA is exposed to the internet and how it is defended.
Read it before adding any route, any skill, or any deployment change.

---

## 0. Threat model

The repository is **public** (`github.com/Ileies/pidra`). Every route, every skill
name, every table and every line of the auth implementation is readable by an
attacker. Nothing in this design may depend on obscurity. No secret has ever been
committed (full history scanned 2026-09-11); that property must hold.

What an attacker gets on success, ranked by damage:

| # | Capability | Reached via |
|---|---|---|
| 1 | Send mail as any of the 13 configured accounts | `send_mail` skill, cleartext SMTP passwords in `email-accounts.json` |
| 2 | Full read of Google account (mail, calendar, tasks, Keep) | `GOOGLE_REFRESH_TOKEN`, `GKEEPAPI_MASTER_TOKEN` in `.env` |
| 3 | Read everything: reports, diary-grade `standing_context`, entities, contacts, notes | Postgres `pidra`; or, for the newest 60 briefings and without raw mail bodies, the offline mirror on an unlocked phone, where the device lock is the only control (`CONTEXT_AND_DECISIONS.md`, "Offline mode") |
| 4 | Rewrite what the system believes and does | `prompt_versions` activation, `skill_overrides` risk downgrade |
| 5 | Write files and spawn processes on the host | `create_file`, `open_project_in_editor` |
| 6 | Unmetered OpenAI spend | `/api/pipeline/run`, `/api/deepen`, `/api/chat` |

Three distinct adversaries, in descending order of **likelihood**:

- **A. The content author.** Someone who writes a newsletter you ingest, or simply
  emails you. They need no access at all: their text enters the model's context
  every morning. This is the most probable attacker by a wide margin and the one
  the login does nothing about. Section 5 is the answer.
- **B. The anonymous internet.** Scanners, then a targeted person who reads the
  public repo. Sections 1-4 and 6 are the answer.
- **C. Post-compromise.** Anyone who reaches a shell on pronix. Sections 6, 7 and
  10 limit blast radius; nothing eliminates it.

Non-goal: defending against a party who controls pronix's root or your Bitwarden
vault. Both are treated as game over, and the plan optimizes for *detecting* it.

---

## 1. Perimeter: a separate auth gate, not app-level middleware

Decided: public ingress with passkeys. mTLS rejected (device friction).
WireGuard-only rejected for the daily read path (travel laptops), but retained
for the admin tier, see §4.

The problem with "just add `hooks.server.ts`": the entire SvelteKit app, the whole
dependency tree, and every `+server.ts` become code that anonymous traffic can
reach and trip over. A single routing mistake or a dependency CVE is total loss,
and the concern is exactly right - "maybe my site has a gap where someone can
suddenly use skills".

So authentication moves **in front of** the app, into a process that does nothing
else.

```
                 internet
                    │
              nginx (pronix, :443, wildcard cert for *.rizinos.com)
                    │
         ┌──────────┴───────────────────────────────┐
         │ auth_request /gate/verify                │
         │  ├─ 200 → proxy_pass 127.0.0.1:3010      │  SvelteKit (adapter-node)
         │  └─ 401 → redirect /gate/login           │
         │                                          │
         │ location /gate/ → 127.0.0.1:3011         │  pidra-gate (Bun, ~300 LOC)
         │ location /hook/sms → 127.0.0.1:4000      │  the one token-auth'd route
         └──────────────────────────────────────────┘
                    │
              127.0.0.1:4000  skills bridge (Hono) - loopback only, never proxied
                    │
              127.0.0.1:5432  Postgres (already local)
```

**`pidra-gate`** is a standalone Bun service. Its entire job:

- `GET /gate/login` - a static page, no framework, no DB read.
- `POST /gate/webauthn/options` + `/gate/webauthn/verify` - `@simplewebauthn/server`.
- `GET /gate/verify` - the `auth_request` target. Validates the session cookie,
  returns 200 or 401, and nothing else. Must be fast: HMAC-verify the cookie,
  check an in-process revocation set, hit Postgres only on cache miss.
- `POST /gate/logout`, `POST /gate/stepup/*` (§5).

Everything reachable by an unauthenticated request is this file plus nginx. That
is the point, and it is what makes public exposure acceptable without mTLS.

nginx sketch, as a new vhost in `/etc/nixos/hosts/pronix/nginx.nix`
(`pidra.rizinos.com`, covered by the existing `*.rizinos.com` ACME cert; note
ports 3000-3008 and 8333 are already taken on pronix, hence 3010/3011):

```nginx
location = /gate/verify {
  internal;
  proxy_pass http://127.0.0.1:3011;
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header X-Original-URI $request_uri;
}

location /gate/ {
  proxy_pass http://127.0.0.1:3011;
  limit_req zone=pidra_login burst=5 nodelay;   # 10r/m
}

location / {
  auth_request /gate/verify;
  auth_request_set $pidra_sid  $upstream_http_x_pidra_session;
  auth_request_set $pidra_seen $upstream_http_x_pidra_authenticated_at;
  error_page 401 = @tologin;

  # never let a client forge these
  proxy_set_header X-Pidra-Session $pidra_sid;
  proxy_set_header X-Pidra-Authenticated-At $pidra_seen;
  proxy_pass http://127.0.0.1:3010;
}

location @tologin { return 302 https://pidra.rizinos.com/gate/login?next=$request_uri; }
```

`proxy_buffering off;` on the assistant SSE location so streaming still works.

**The app re-verifies independently.** `hooks.server.ts` validates the session
cookie against Postgres itself and never trusts `X-Pidra-*` as proof. The headers
are a convenience, not an authorization. Two independent checks means neither a
missing nginx location nor a direct LAN hit on :3010 yields access.

Rate limiting: `limit_req_zone $binary_remote_addr zone=pidra_login:1m rate=10r/m;`
on `/gate/`, plus a second zone at 60r/m on `/` to cap cost-DoS. fail2ban watches
nginx for 401s from `/gate/webauthn/verify` and bans after 5 in 10 minutes.

Headers on the vhost: HSTS with `preload`, `Content-Security-Policy` with
`default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`,
`Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`,
`Permissions-Policy` denying everything except `publickey-credentials-get`.

---

## 2. Identity: passkeys, Bitwarden as the root

One human, one account, no password anywhere in the system. Passwords are the
thing that gets phished and reused; there is no reason to have one here.

- **Primary credential: a passkey stored in Bitwarden.** It syncs to the browser
  extension on prenix, and to the Bitwarden apps on Android and iOS. One
  enrollment covers three of the four device classes.
- **Travel laptops need no provisioning at all.** WebAuthn hybrid transport ("use
  a phone or tablet") shows a QR code; you scan it with the phone holding the
  passkey and authenticate over BLE proximity. This is why mTLS was the wrong
  trade for you - client certs are exactly what you cannot install on a machine
  you do not own, and passkeys solve that case natively.
- **Plus one platform passkey per device you own** (prenix browser profile,
  Android credential manager, iCloud Keychain) as redundancy, so a Bitwarden
  outage is an inconvenience rather than a lockout.
- `userVerification: "required"` on both registration and assertion - biometric
  or PIN, never possession alone.
- Store `credential_id`, `public_key`, `sign_count`, `transports`, `aaguid`,
  `friendly_name`, `created_at`, `last_used_at`, `created_from_ip`. Reject an
  assertion whose `sign_count` goes backwards (clone detection; tolerate `0`,
  which Bitwarden and most synced providers report).

**Enrollment is never reachable from the internet.** No open registration route,
ever. To add a credential:

1. SSH to pronix, run `bun run scripts/mint-enrollment-token.ts`.
2. It prints a single-use token, valid 10 minutes, bound to one credential.
3. `/gate/enroll?t=<token>` accepts it, **and only when the request arrives over
   `wg0` or loopback** - the gate checks the source address, not a header.

This makes SSH-to-pronix the root of trust for the whole identity system, which is
appropriate: it is key-only and already your strongest credential.

**Recovery / break-glass.** No hardware key means no offline recovery token worth
having. The break-glass path is SSH → mint an enrollment token → enroll a new
passkey. Keep the pronix SSH private key backed up somewhere outside the laptop
(printed paper in a safe, or a second machine). Store a copy of the SSH key's
passphrase and the Bitwarden master password in physically separate places. That
is the whole recovery design; write it down offline, because the dashboard cannot
help you recover access to the dashboard.

**Alerting on enrollment.** Every credential registration writes an `auth_events`
row and fires a Web Push notification to all *other* registered subscriptions,
plus a `notes` row with scope `global`. If a credential ever appears that you did
not add, you find out in seconds.

---

## 3. Sessions

- Cookie `__Host-pidra_session`: implies `Secure`, `Path=/`, no `Domain`, so it
  cannot be injected by a sibling subdomain on `rizinos.com`. Given the wildcard
  cert covers a dozen other apps on this box, the `__Host-` prefix is doing real
  work here, not ceremony.
- `HttpOnly`, `SameSite=Lax`. Lax rather than Strict, so tapping a push
  notification opens the dashboard already logged in. Lax still blocks
  cross-site POST, and the gate re-checks `Origin` on every state-changing
  request anyway.
- Value: 32 random bytes, base64url. Stored in Postgres as `sha256(value)` only,
  so a database dump does not yield live sessions.
- `sessions` columns: `id`, `token_hash`, `credential_id`, `created_at`,
  `last_seen_at`, `authenticated_at`, `absolute_expires_at`, `ip`, `user_agent`,
  `revoked_at`.
- Idle timeout 7 days on the read tier, absolute expiry 30 days, no renewal past
  it. `authenticated_at` is what §5 reads for step-up freshness and is **never**
  bumped by ordinary activity.
- A `/gate/sessions` page lists active sessions with device and IP, and revokes
  any or all. Revocation is instant because the gate keeps the revocation set in
  memory.
- Set `ORIGIN=https://pidra.rizinos.com` on the adapter-node process. Without it
  SvelteKit's built-in origin check on form actions is unreliable, and every
  mutating form action in the dashboard depends on it.

---

## 4. Three exposure tiers

Not everything needs to be reachable from a hotel wifi. Splitting the surface is
the cheapest large win available, and it is what limits the damage if the gate
does have a gap.

**Tier 1 - public, passkey session only.** The daily loop: read the report, rate
items, read and write notes, browse entities and sources, read the skill log, chat
with the assistant in read-only mode.

**Tier 2 - public, passkey session + fresh step-up (§5).** Anything that writes
outside the database or changes durable state: `send_email`, `send_mail`,
`revise_context`, `revert_context_revision`, `add_calendar_event`,
`add_todo_item`, `complete_todo_item`, `set_source_active`,
`propose_prompt_version`.

**Tier 3 - `wg0` or loopback only, never proxied by nginx.** The operations that
convert a foothold into total control:

- `PATCH /skills/:name`, `DELETE /skills/:name/override` - a risk-level downgrade
  is a privilege escalation primitive; today anyone can lower `send_mail` to
  `low`.
- `POST /api/prompts/:id/approve` - activating a prompt version changes what every
  future run executes. This is remote code execution for an LLM system.
- `POST /api/context-builder/start` / `stop` - spawns a process on the host.
- `POST /api/pipeline/run` - unmetered spend. Keep the scheduled 06:30 run; make
  the manual trigger tunnel-only.
- `POST /skills/execute` on the bridge - see §8, it currently bypasses the surface
  policy outright.
- `create_file` and `open_project_in_editor` - **delete these from the deployed
  server entirely**. Spawning an editor on a headless box is not a feature, it is
  a process-execution primitive, and neither skill has a use case that survives
  the move to pronix.

Enforcement is in two independent places: nginx simply has no `location` for the
Tier 3 paths, and `hooks.server.ts` rejects them unless the connection arrives
over loopback or `10.200.200.0/24`. You already run WireGuard on pronix; this
costs you nothing new and you only need the tunnel up on the rare occasions you
are actually administering the thing.

---

## 5. Step-up authorization: the defense that actually matters

Adversary A needs no credentials. They write a newsletter you subscribe to, or
send you one email. Their text lands in `raw_items`, flows through extraction into
the report, and appears in the assistant's context. If the model can call
`send_mail` while reading attacker-controlled text, the login is irrelevant.

Three layers, in order of importance.

**5.1 The pipeline can never write.** The `system` actor gets a read-only skill
registry, structurally, not by policy. Add an `effect: "read" | "write" |
"outbound"` field to the `Skill` interface and have `executeSkill()` reject any
non-`read` skill whose `ctx.actor === "system"`. A system actor cannot step up -
no human is present at 06:30 - so this falls out of the design rather than being a
separate rule. Extend `scripts/check-skill-writes.ts` to fail the build if a skill
lacks an `effect` declaration.

**5.2 Interactive writes require a fresh, action-bound assertion.** In
`executeSkill()`, before the risk check:

```
if (skill.effect !== "read" && ctx.actor !== "user_direct") {
  const proof = await consumeStepUp(ctx.executionId);
  if (!proof) return reject("step_up_required");
}
```

Flow: the chat loop wants to call `send_mail`. `executeSkill` inserts the row as
`pending_step_up` with the exact serialized parameters, and returns a challenge id
to the UI. The dashboard renders **what is about to happen** - skill, recipient,
subject, body - and a single "Approve" button. Clicking it performs a WebAuthn
assertion whose challenge is bound server-side to that one pending execution.
Only then does the skill run, once, with the parameters that were displayed.

Honest limitation: the authenticator cannot display the action text - `txAuthSimple`
is effectively unimplemented across the ecosystem. The binding is server-side, and
the human reads the action in the browser, not on the authenticator. What this
buys is nonetheless decisive: an injected instruction cannot approve itself, and
an approval you gave for one action cannot be replayed onto another, because the
challenge is consumed and tied to a specific parameter hash.

Freshness: 5 minutes, single use, never extended by activity.

**5.3 Narrow the outbound skills regardless.**

- `skills/send_mail.ts` has **no recipient allowlist** (`:83`). Give it the same
  `ALLOWED_EMAIL_RECIPIENTS` check `send_email.ts:27` has, and make the default
  empty rather than a hardcoded address.
- Both mail skills become `effect: "outbound"`, and `risk_level: "high"` so they
  also land in the existing confirmation queue. Belt and braces: step-up is the
  cryptographic control, the risk tier is the audit control.
- Cap outbound mail at N per day in `executeSkill`, counted from
  `skill_executions`. A prompt injection that gets through should not be able to
  send 500 messages before you notice.
- Mark ingested content as untrusted where it enters the prompt. Wrap
  extraction output in explicit delimiters with a standing instruction that
  content inside them is data, never instruction. This is a mitigation, not a
  control - it raises the cost, it does not close the hole. Only 5.1 and 5.2 do.

---

## 6. Process isolation and bind addresses

The dashboard's bind address must be verified in its systemd unit before public exposure. The skills bridge already defaults to loopback.

- `src/server/index.ts` already sets `hostname: process.env.SKILLS_BRIDGE_HOST ?? "127.0.0.1"`.
  Keep that loopback default and do not override it with a non-loopback address. The bridge is
  never proxied by nginx and never leaves the box, as documented in `CLAUDE.md`'s Skills section.
- adapter-node - `HOST=127.0.0.1 PORT=3010` in the systemd unit.
  `dashboard/build/index.js:236` defaults to `0.0.0.0` otherwise.
- `idleTimeout: 0` on the bridge is deliberate: assistant SSE turns can be quiet longer than a
  short server idle timeout. Bound request and connection abuse at the reverse-proxy and gate
  layers instead; do not reintroduce a generic Bun idle timeout that truncates valid streams.
- Drop the Hono `cors()` at `src/server/index.ts:25`. It covers only `/api/*`,
  not `/skills/execute`, and it is a browser policy that does nothing against
  curl. It reads as protection while providing none - worse than absent.

**Deployment (new, none exists today).** A `pidra.nix` module in
`/etc/nixos/hosts/pronix/`, three systemd units running as an unprivileged
`pidra` user with no login shell:

- `pidra-gate.service` → :3011
- `pidra-dashboard.service` → :3010
- `pidra-bridge.service` → :4000 (loopback)
- `pidra-cron.service` - `src/cron.ts` currently holds the whole schedule
  in-process with nothing supervising it. Either supervise it here with
  `Restart=always`, or move the six jobs to systemd timers, which is the better
  answer since a crashed `node-cron` process is silently no briefing.

Hardening on each unit: `NoNewPrivileges=true`, `ProtectSystem=strict`,
`ProtectHome=true`, `PrivateTmp=true`, `PrivateDevices=true`,
`ProtectKernelTunables=true`, `ProtectControlGroups=true`,
`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `RestrictNamespaces=true`,
`LockPersonality=true`, `MemoryDenyWriteExecute` where Bun tolerates it (test -
JIT may not), `SystemCallFilter=@system-service`,
`ReadWritePaths=` limited to the state directory only.

`ProtectHome=true` alone kills `create_file`'s `~/Documents` target and
`open_project_in_editor` - which is the correct outcome and another reason to
remove both (§4).

**Postgres.** The `pidra` database already exists on pronix. Give it a dedicated
role that is not superuser, owning only its own tables, with no `CREATEDB` and no
access to the `rizinos` or `vaultwarden` databases on the same instance. Confirm
`listen_addresses` is loopback and that pg_hba has no `trust` entries.

---

## 7. Secrets

Today: `.env` and `email-accounts.json` sit in the repo working directory in
cleartext, holding SMTP passwords for 13 accounts, a Google refresh token, a Keep
master token and the OpenAI key. `src/config/email-accounts.ts:33` reads it via
`process.cwd()`, so it only resolves when launched from the repo root - fragile
in a systemd unit.

- Move both into `agenix-rekey`, which you already use for every other pronix
  secret (`/etc/nixos/secrets/rekey/`). New entries:
  `pronix-pidra-env.age`, `pronix-pidra-email-accounts.age`.
- Deliver via systemd `LoadCredential=`, read from `$CREDENTIALS_DIRECTORY`, mode
  `0400`, owner `pidra`. Change `loadEmailAccounts()` to read
  `PIDRA_EMAIL_ACCOUNTS_PATH` with the cwd behaviour as a dev-only fallback.
- **Minimize Google scope.** `GOOGLE_REFRESH_TOKEN` currently grants far more than
  the pipeline needs. Re-issue with read-only scopes for Gmail and Calendar; keep
  write scope only for Tasks, which `add_todo_item` genuinely needs. This is the
  single highest-value item in this section: that one token is item 2 in the
  threat table and it is currently full access.
- Rotate the OpenAI key and the Brave key on first deploy, on the assumption that
  anything that has lived in a working directory for months is already exposed.
- Consider whether the daily briefing needs `GKEEPAPI_MASTER_TOKEN` at rest at all,
  given Keep is not yet a pipeline source (`CLAUDE.md`, "What not to build yet").
  If it is only used by the Context Builder, it does not belong in the always-on
  server's environment.
- Check that pronix's disk is encrypted. If it is not, every table in §0 is
  readable by anyone with physical access or a Netcup console, and no amount of
  application security changes that.

---

## 8. Bugs to fix before any of this ships

These are live defects found in the 2026-09-11 audit, independent of the
architecture above. Several of them defeat the architecture if left in place.

| # | Issue | Location |
|---|---|---|
| 1 | `POST /skills/execute` passes no `surface`, so `executeSkill`'s per-surface allowlist (`src/skills/execute.ts:63`) is skipped entirely. Every skill is callable with arbitrary params. **Make `surface` mandatory, or delete the route.** | `src/server/index.ts:55` |
| 2 | `POST /api/push/subscribe` is unauthenticated. Anyone can register a push endpoint and receive your briefing summaries (`src/push.ts:17`), or delete your subscription. Bind rows to a session, require auth, and prune on session revocation. | `dashboard/src/routes/api/push/subscribe/+server.ts:13` |
| 3 | `/api/notes/[...path]` interpolates the path segment into the bridge URL unsanitized - an open proxy into any bridge route. Replace with explicit route mapping. | `dashboard/src/routes/api/notes/[...path]/+server.ts:11` |
| 4 | The SMS webhook **fails open**: `if (secret && ...)` skips the check when `SMS_WEBHOOK_SECRET` is unset - and it is not set, in `.env` or `.env.example`. Fail closed, compare in constant time, document the var. | `src/server/index.ts:98` |
| 5 | `send_mail` has no recipient allowlist. | `skills/send_mail.ts:83` |
| 6 | `send_email` hardcodes `port: 587, secure: false` and reuses `IMAP_*` credentials as SMTP. Use the account config, require STARTTLS, fail if the upgrade does not happen. | `skills/send_email.ts:32` |
| 7 | Skill risk level is mutable at runtime via `PATCH /skills/:name` with no auth - an attacker downgrades `send_mail` to `low` and skips every gate. Tier 3, and forbid downgrades below the code-declared baseline entirely. | `src/server/index.ts:30` |
| 8 | `"dev": "bun run src/index.ts"` - that file does not exist. Broken script, worth knowing before you write a unit file around it. | `package.json:9` |
| 9 | `.env` says `GKEEPAPI_EMAIL`, `.env.example` says `GKEEPAPI_USERNAME`. Reconcile. | - |
| 10 | Four `+page.server.ts` files read `process.env` directly instead of `$env/dynamic/private`. Not a leak, but inconsistent and easy to get wrong later. | `prompts:4`, `sources:4`, `sources/[name]:7`, `skills:6` |

---

## 9. Notifications survive all of this

Worth stating plainly, because it drove the perimeter decision: **Web Push needs
no inbound reachability.** `src/push.ts` sends outbound to FCM and APNs, which
deliver to the device. The morning notification arrives whether or not the
dashboard is publicly reachable, whether or not WireGuard is up, and whether or
not your session has expired.

What ingress buys you is the ability to *tap* the notification and read the
briefing immediately. That is the only thing being protected here, which is worth
remembering when weighing friction.

Two adjustments:

- Keep the push payload short. It is encrypted to the subscription's keys, but it
  lands on a lock screen. "Your briefing is ready - 4 personal, 12 intel" rather
  than the summary text currently sent at `src/push.ts:17`.
- `notificationclick` opens `/`; with `SameSite=Lax` the session cookie rides
  along and you land on the report. If the session has expired you get the gate's
  login page and one biometric touch.

---

## 10. Audit, detection, recovery

The realistic outcome of good security is not "never breached", it is "you find
out the same day".

- New table `auth_events`: every login attempt, success and failure, every
  step-up grant and denial, every enrollment, every session revocation, with IP,
  user agent and outcome. Append-only, never deleted.
- Web Push alert, immediately, on: a new credential enrolled, a login from an IP
  in a country you were not in, a step-up denial, more than 3 failed assertions,
  any Tier 3 access, any `send_mail` execution.
- A `/security` dashboard page: active sessions, registered credentials with last
  use, recent `auth_events`, outbound mail in the last 30 days. One place to look.
- Daily encrypted `pg_dump` of `pidra` to a location that a compromise of pronix
  does not reach. Everything in §0 items 3 and 4 is irreplaceable and currently
  has no backup story in this repo.
- `bun audit` (or equivalent) in `bun run check`, and keep `adapter-node`,
  `@simplewebauthn/*` and `hono` current. Public repo means dependency CVEs are
  matched against you automatically.

---

## 11. Phasing

Ship in this order. Each phase leaves the system strictly safer than the last, and
phase 0 is worth doing today regardless of whether the rest ever gets built.

**Phase 0 - stop the bleeding (hours).** No new code, only bind addresses and
deletions. Bridge and dashboard to `127.0.0.1`. Delete `create_file` and
`open_project_in_editor`. Fix §8 items 1, 4 and 5. Confirm nothing is currently
reachable from outside the LAN.

**Phase 1 - the gate (days).** `pidra-gate` service, `sessions` and
`webauthn_credentials` tables, enrollment CLI restricted to loopback and `wg0`,
nginx vhost with `auth_request`, `hooks.server.ts` doing its independent check.
At the end of this phase the dashboard is publicly reachable and passkey-gated.

**Phase 2 - deployment and secrets (days).** The `pidra.nix` module, three
hardened systemd units, agenix for `.env` and `email-accounts.json`, Google scope
reduction, key rotation, Postgres role hardening, backups.

**Phase 3 - tiering (days).** Tier 3 paths removed from nginx and rejected in the
app. Remaining §8 items.

**Phase 4 - step-up (a week).** `effect` on the `Skill` interface, system actor
locked to read-only, pending-execution flow, action-bound WebAuthn assertions,
outbound rate cap, untrusted-content delimiters.

**Phase 5 - observability.** `auth_events`, push alerts, `/security` page.

Phases 0 and 4 are the ones that matter most, and they defend against different
adversaries. Phase 1 is what makes the thing usable from a hotel. Do not let
phase 4 slip merely because the login feels like it finished the job - it defends
against adversary B, and adversary A is the one who is already inside.
