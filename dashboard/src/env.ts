import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	// The bridge is loopback-only and always local to whichever host runs the dashboard (CLAUDE.md,
	// Skills). The default lives here, in the schema: a blanket `?? ''` once resolved an unset var to
	// an empty string, so a fallback written at the call site never ran and every proxied write
	// 502'd with an empty target URL.
	SKILLS_BRIDGE_URL: { schema: (input) => input ?? 'http://localhost:4000' },
	DATABASE_URL: { schema: (input) => input ?? '' },
	PUBLIC_MODEL_PRICE_IN_PER_MTOK: { public: true, schema: (input) => input ?? '' },
	PUBLIC_MODEL_PRICE_OUT_PER_MTOK: { public: true, schema: (input) => input ?? '' },
	CONTEXT_BUILDER_OUTPUT_DIR: { schema: (input) => input ?? '' },
	PUBLIC_VAPID_KEY: { public: true, schema: (input) => input ?? '' },
	// Undeclared defaults (`pidra.de` over https) live in `rpConfig()` (`$lib/server/auth.ts`), not
	// here, so `input` passes through as `undefined` when unset.
	AUTH_RP_ID: { schema: (input) => input },
	AUTH_ORIGIN: { schema: (input) => input },
	CONFIG_ENCRYPTION_KEY: { schema: (input) => input },
	AUTH_SETUP_TOKEN: { schema: (input) => input }
});
