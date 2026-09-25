import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	// The bridge is loopback-only and always local to whichever host runs the dashboard (CLAUDE.md,
	// Skills). Every caller already wrote `SKILLS_BRIDGE_URL ?? "http://localhost:4000"`, which the
	// migration's blanket `?? ''` silently defeated - an unset var resolved to '' (not undefined),
	// so that fallback never ran and every proxied write 502'd with an empty target URL.
	SKILLS_BRIDGE_URL: { schema: (input) => input ?? 'http://localhost:4000' },
	DATABASE_URL: { schema: (input) => input ?? '' },
	PUBLIC_MODEL_PRICE_IN_PER_MTOK: { public: true, schema: (input) => input ?? '' },
	PUBLIC_MODEL_PRICE_OUT_PER_MTOK: { public: true, schema: (input) => input ?? '' },
	CONTEXT_BUILDER_OUTPUT_DIR: { schema: (input) => input ?? '' },
	PUBLIC_VAPID_KEY: { public: true, schema: (input) => input ?? '' }
});
