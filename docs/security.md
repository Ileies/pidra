# Security

The controls visible in the repository and the pronix NixOS flake, as of 2026-10-02. This is a code and configuration review, not a verification of the running server. Open work is in [todo/security.md](todo/security.md).

## Exposure and trust boundaries

The source repository is public: assume an attacker knows every route, skill, table and authentication rule. The most likely untrusted input is an email, newsletter or web page that the pipeline or assistant reads. Other adversaries: an unauthenticated internet visitor, someone with a valid dashboard session, and someone with local access to pronix. Root on pronix or control of the owner's credential vault is outside the application boundary.

The highest-impact assets are the mail accounts, Google and other API tokens, the personal database and harvested context, prompt and skill settings, and the host. The offline mirror also holds recent personal data on an unlocked device, so the device lock is the local access boundary.

## Internet ingress

- `pidra.de` is served by nginx over TLS with HSTS for one year. nginx proxies the dashboard to port 3009 and rate-limits `/api/auth/` to 5 requests per minute per IP with a burst of 10 (`/etc/nixos/hosts/pronix/nginx.nix`).
- The dashboard listens on `0.0.0.0:3009`. The firewall opens that port on `wg0` only and nginx reaches it over loopback, so it is not internet-facing (`/etc/nixos/hosts/pronix/pidra.nix`).
- The skills bridge binds `127.0.0.1:4000` by default (`src/server/index.ts`) and nginx does not proxy it. Its endpoints have no authentication, so loopback binding is a security boundary.
- `dashboard/src/hooks.server.ts` requires a valid session for every route except a fixed allowlist: login, setup, privacy, terms, the manifest and service worker, static assets, health and `/api/auth/`. Unknown routes require login. This is an application gate: anonymous requests still reach the SvelteKit process.
- The hook sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and an enforced CSP for framing, objects and base URLs. The broader resource CSP is still report-only (`CSP_REPORT_ONLY`). Truly prerendered static pages bypass the hook's headers.

## Identity and sessions

- Login is a WebAuthn passkey assertion followed by a 6 to 10 digit PIN hashed with Argon2id. WebAuthn challenges, the passkey-verified intermediate state and attempt counters are held in process memory. Lockouts: 5 PIN attempts per verified passkey step, and an IP lockout after 10 failures (15 minutes, doubling per repeat), in addition to the nginx rate limit.
- The first credential is registered through `/setup` using `AUTH_SETUP_TOKEN`. Once a credential exists for the current relying-party ID, setup and credential management require an existing session. `/setup` can list credentials and sessions, remove a credential and revoke a session; the last credential cannot be removed.
- WebAuthn requests use `userVerification: "preferred"`; the separate PIN is part of the login flow. Credential management does not demand a fresh passkey assertion after login.
- The `pidra_session` cookie is `Secure`, `HttpOnly`, `SameSite=Lax` and valid for 30 days, with an absolute expiry and no idle timeout. Its 32-byte random value is stored only as a SHA-256 hash in `auth_sessions`; validation queries Postgres on each request and revocation deletes the row. The cookie does not use the `__Host-` prefix.

## Authorization and model actions

- The assistant's page surfaces (`src/ai/surfaces.ts`) limit the skills offered in chat. `executeSkill()` checks a surface when the caller supplies one, writes an execution log, runs low and medium skills immediately, queues high skills for manual confirmation and rejects critical skills.
- The bridge's direct `POST /skills/execute` supplies no surface, so it bypasses the per-page allowlist. `PATCH /skills/:name` only toggles a skill enabled or disabled (`disabled_skills`), but an unauthenticated caller reaching the bridge can still turn any skill off.
- `send_email`, `send_mail`, `create_file` and `open_project_in_editor` are on no assistant surface but stay registered as bridge skills, all at medium risk. `send_mail` accepts any recipient; `send_email` has an allowlist with a hardcoded default. There is no action-bound passkey approval for outbound or other consequential writes.
- Prompt activation requires a dashboard action, and `prompt_versions` keeps the active override separate from the code defaults. The dashboard session authorizes it; there is no separate administrator or fresh-authentication tier.
- Ingested text stays untrusted even after extraction compresses it, and a dashboard login does not prevent prompt injection in mail or web content. `executeSkill()` has no universal read-only policy for the `system` actor and no action-bound approval rule.
- Answering a question starts an unattended chat turn on the `questions` surface, which carries broad medium-risk edit skills (`revise_context`, `remove_context_item`, `add_contact`, `set_source_active`, notes, to-dos, calendar). The question's mail details are untrusted and the prompt says only the answer is an instruction, but that is a prompt rule, not an enforced boundary. Every change is an audited skill call and the context edits are reversible. The assistant can also queue questions itself (`create_question`, at most 10 open).
- Reports are immutable to skills, notes have a single revision-tracked writer and context corrections are append-only (`docs/architecture-rules.md`).

## Data, notifications and operations

- Email account passwords are encrypted in Postgres with AES-256-GCM, keyed by `CONFIG_ENCRYPTION_KEY` in `.env`. The workstation and pronix each keep their own gitignored `.env`; the pronix units load it as an `EnvironmentFile`, not through systemd credentials. The monthly Context Builder also needs the Keep master token on pronix.
- The Keep fetch drops `Credentials`-labelled notes before any consumer sees them. OpenAI calls use `store: false`; web research uses the Brave client. The offline snapshot excludes raw mail bodies and the sensitive tables listed in `docs/offline-mode.md`, but the personal data it does carry is readable on an unlocked device.
- Push subscriptions are created and removed through authenticated dashboard routes. Rows are not linked to sessions, so revoking a session does not prune its subscriptions. The briefing push can show up to 120 characters of model-generated summary on the lock screen (`src/push.ts`).
- The bridge and dashboard run as systemd services and scheduled jobs as separate timers. The NixOS module declares no dedicated service user, filesystem sandboxing or `LoadCredential`.
- There is no `auth_events` table, `/security` page or off-host encrypted database backup in the repository. The Postgres role, disk encryption, backup state and deployed firewall must be checked on pronix before claiming those controls are active.
