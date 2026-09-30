# Security

This describes the controls visible in the repository and the pronix NixOS flake as of 2026-09-30. It is a code and configuration review, not a verification of the running server. Open work is tracked in [todo/security.md](todo/security.md).

## Exposure and trust boundaries

The source repository is public. Assume an attacker knows every route, skill, table and authentication rule. The most likely untrusted input is an email, newsletter or web page that the pipeline or assistant reads. Other relevant adversaries are an unauthenticated internet visitor, someone with a valid dashboard session, and someone with local access to pronix. Root access to pronix or control of the owner's credential vault is outside the application boundary.

The highest-impact assets are the configured mail accounts, Google and other API tokens, the personal database and harvested context, prompt and skill settings, and the host. The offline mirror also holds recent personal data on an unlocked device. Its device lock is the local access boundary.

## Internet ingress

- `pidra.de` is publicly served by nginx over TLS. nginx proxies the dashboard to port 3009 and rate-limits `/api/auth/` to 5 requests per minute per IP with a burst of 10. The vhost sets HSTS for one year. See `/etc/nixos/hosts/pronix/nginx.nix`.
- The dashboard listens on `0.0.0.0:3009`. The host firewall allows that port from `wg0`, and nginx reaches it through loopback. It is not an internet-facing port in the NixOS firewall. See `/etc/nixos/hosts/pronix/pidra.nix`.
- The skills bridge defaults to `127.0.0.1:4000` in `src/server/index.ts`. nginx does not proxy it. Bridge endpoints themselves have no authentication, so loopback binding is a security boundary.
- `dashboard/src/hooks.server.ts` requires a valid session for every route except its fixed public allowlist: login, setup, privacy, terms, static assets, health and `/api/auth/`. Unknown routes require login. This is an application gate: anonymous requests still reach the SvelteKit process.
- The hook sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and an enforced CSP for framing, objects and base URLs. The broader resource CSP is still report-only. Truly prerendered static pages bypass the hook's headers.

## Identity and sessions

- Login requires a WebAuthn passkey assertion followed by a 6 to 10 digit PIN. The PIN hash uses Argon2id. WebAuthn challenges, the passkey-verified intermediate state and login attempt counters are held in process memory. Authentication uses IP lockout in addition to nginx rate limiting.
- The first credential is registered through `/setup` using `AUTH_SETUP_TOKEN`. Once a credential exists for the current relying-party ID, setup and subsequent credential management require an existing session. `/setup` can list credentials and sessions, remove a credential and revoke a session. The last credential cannot be removed.
- WebAuthn requests currently use `userVerification: "preferred"`. The separate PIN is part of the current login flow. Credential management does not demand a fresh passkey assertion after login.
- The `pidra_session` cookie is `Secure`, `HttpOnly`, `SameSite=Lax` and valid for 30 days. Its 32-byte random value is stored only as a SHA-256 hash in `auth_sessions`. The session has an absolute expiry but no separate idle timeout. Session revocation deletes the row; validation queries Postgres on each request. The cookie does not use the `__Host-` prefix.

## Authorization and model actions

- The assistant's page surfaces in `src/ai/surfaces.ts` limit the skills offered in chat. `executeSkill()` checks a surface when the caller supplies one, writes an execution log, immediately runs low and medium skills, queues high skills for manual confirmation, and rejects critical skills.
- The bridge's direct `POST /skills/execute` call supplies no surface. Its skill override endpoints can change a risk level below its code-defined value. These endpoints rely on the bridge's loopback boundary, and their behavior is a material gap if that boundary is crossed.
- `send_email`, `send_mail`, `create_file` and `open_project_in_editor` are absent from assistant surfaces but remain registered as bridge skills. `send_mail` accepts any recipient; `send_email` has an allowlist with a hardcoded default. Both are currently medium risk. There is no action-bound passkey approval for outbound or other consequential writes.
- Prompt activation requires a dashboard action, and `prompt_versions` keeps the active override separate from code defaults. The dashboard session currently authorizes that action; there is no distinct administrator or fresh-authentication tier.
- Ingested text is untrusted even when an extraction has compressed it. A dashboard login does not prevent prompt injection in mail or web content. The pipeline and chat do not have a universal read-only `system` skill policy or an action-bound approval rule in `executeSkill()`.
- Reports are immutable to skills, notes have a single revision-tracked writer, and context corrections are append-only. These data boundaries are described in `docs/architecture-rules.md`.

## Data, notifications and operations

- Email account passwords are encrypted in Postgres with AES-256-GCM; `CONFIG_ENCRYPTION_KEY` is kept in `.env`. The workstation and pronix each keep their own gitignored `.env`. The pronix systemd units use it as an `EnvironmentFile`; they do not use systemd credentials. The monthly Context Builder also requires the Keep master token on pronix.
- The Keep fetch path excludes notes labelled `Credentials` before downstream processing. OpenAI calls use `store: false`; web research uses the Brave client. The offline snapshot excludes raw mail bodies and the specified sensitive tables, but its mirrored personal data remains readable on an unlocked device.
- Push subscriptions are created and removed through authenticated dashboard routes because the hook covers `/api/push/subscribe`. Rows are not linked to sessions, and revoking a session does not prune its subscriptions. The briefing push can include up to 120 characters of model-generated summary text on the lock screen.
- The bridge and dashboard run as systemd services; scheduled jobs use separate systemd timers. The checked NixOS module does not declare a dedicated service user, filesystem sandboxing controls or `LoadCredential`.
- The repository has no `auth_events` table or `/security` page. It does not define an off-host encrypted database backup. The actual Postgres role, disk encryption, backup state and deployed firewall must be checked on pronix before claiming those controls are active.
