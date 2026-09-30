# Security work

Open security work, ordered by impact. [docs/security.md](../security.md) records the current controls and trust boundaries. Remove completed entries rather than leaving checked boxes.

## Immediate: close bypasses

- **[BUG] SMS webhook:** Make `POST /webhook/sms` reject every request when `SMS_WEBHOOK_SECRET` is absent, compare the supplied secret without a timing leak, document the required setting, and test the unset, wrong and valid cases. `src/server/index.ts` currently skips the check when the setting is empty.
- **[BUG] Bridge execution:** Remove `POST /skills/execute` if no caller needs it, or give manual execution its own authenticated, constrained policy. It currently calls `executeSkill()` without a surface, bypassing the per-page allowlist. Preserve the existing audit and risk checks.
- **[BUG] Notes proxy:** Replace the catch-all `/api/notes/[...path]` URL construction with explicit allowed bridge routes and methods. Test encoded and nested paths so a dashboard session cannot steer it to another bridge endpoint.
- **[BUG] Outbound mail:** Give `send_mail` an explicit recipient allowlist with an empty default. Remove the hardcoded default recipient from `send_email`; use configured SMTP account settings and require TLS. Raise both mail skills to high risk, and add a per-day outbound cap enforced at execution time.

## Authorization and prompt injection

- **[SECURITY] Action approval:** Add an effect classification for every skill and reject write and outbound effects from a system actor. Require a fresh, single-use WebAuthn assertion bound to the exact parameters of each consequential interactive action. Display those parameters before approval, persist a pending execution, and consume the proof once. Cover quick actions and the high-risk queue so neither can bypass the same rule.
- **[SECURITY] Administrative actions:** Define a stronger access rule for prompt activation, skill enable/disable, manual pipeline runs and Context Builder start or stop. Enforce it in the dashboard and at the bridge boundary. Decide whether the rule is VPN-only, fresh passkey authorization, or both; a normal 30-day session currently reaches these operations.
- **[SECURITY] Ingested instructions:** Mark newsletter, mail and web-derived text as untrusted in extraction and synthesis prompts. Keep the structural skill restrictions above as the enforcement boundary, and test malicious content that asks the assistant to send mail or change state.
- **[SECURITY] Front gate review:** Decide whether the public dashboard may continue to use SvelteKit's app-level auth hook as its only HTTP authentication gate. If that exposure is unacceptable, put independent authentication in nginx before the dashboard, while keeping the app's own session validation.
- **[SECURITY] Request boundaries:** Audit every state-changing dashboard endpoint and form for Origin or CSRF enforcement, including `/api/auth/` and JSON APIs. Rate-limit costly authenticated routes at nginx or the application boundary. Remove the bridge's `/api/*` CORS middleware if no browser caller needs it; CORS does not authenticate the loopback bridge.
- **[SECURITY] Auth lifecycle:** Review `userVerification: "preferred"` alongside the separate PIN; require verification when supported and tested. Require fresh proof for credential enrollment, removal and PIN changes; define an offline recovery procedure. Consider the `__Host-` cookie prefix and an idle timeout, then test login, logout, revocation and session expiry.
- **[SECURITY] Push subscriptions:** Bind subscriptions to sessions or devices and remove or invalidate them on revocation. Keep briefing push text short enough for a lock screen, without report summary content.

## Host, secrets and recovery

- **[INFRA] Service isolation:** Confirm deployed bind addresses and firewall rules. Run PIDRA under a dedicated unprivileged service account, restrict filesystem writes and systemd capabilities, and test which sandbox options Bun tolerates. Keep the bridge loopback-only. Remove `create_file` and `open_project_in_editor` from the deployed skill registry if they have no server use case.
- **[INFRA] Secrets:** Move the pronix environment out of the checkout into a protected systemd credential or the existing agenix setup. Determine whether the Keep master token can be present only for the monthly job.
- **[INFRA] Database and backups:** Verify the PIDRA Postgres role cannot access other databases or create databases, check `pg_hba` and listening addresses, confirm disk encryption, and add a tested encrypted backup to storage outside pronix. Document a restore drill.
- **[INFRA] Detection:** Add append-only authentication events for login attempts, credential changes, session revocation and denied step-up. Alert on new credentials, repeated failures, sensitive admin actions and outbound mail. Provide a dashboard security view for sessions, credentials and recent events.
- **[INFRA] Dependency and config checks:** Add a dependency audit to `bun run check`, make the resource CSP enforcing after browser validation, and repair the `dev` script that points to missing `src/index.ts`. Verify production nginx and systemd settings against the NixOS flake after rebuilds.
