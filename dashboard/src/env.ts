import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	// Loopback-only bridge. The default lives in the schema: a call-site `?? 'x'` fallback never ran
	// because an unset var resolved to '' (empty target URL, every proxied write 502'd).
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
