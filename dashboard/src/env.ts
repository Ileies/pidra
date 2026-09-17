import { defineEnvVars } from '@sveltejs/kit/env';

// @migration-task Review usage of dynamic environment variables. They fall back to the empty string if not present, which may not be what you want.
export const variables = defineEnvVars({
	SKILLS_BRIDGE_URL: { schema: (input) => input ?? '' },
	DATABASE_URL: { schema: (input) => input ?? '' },
	PUBLIC_MODEL_PRICE_IN_PER_MTOK: { public: true, schema: (input) => input ?? '' },
	PUBLIC_MODEL_PRICE_OUT_PER_MTOK: { public: true, schema: (input) => input ?? '' },
	CONTEXT_BUILDER_OUTPUT_DIR: { schema: (input) => input ?? '' },
	PUBLIC_VAPID_KEY: { public: true, schema: (input) => input ?? '' }
});
