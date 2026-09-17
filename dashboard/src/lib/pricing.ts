/**
 * Token cost, in one place.
 *
 * The Context Builder page used to compute its cost with $3.00 / $15.00 per Mtok - Sonnet's
 * prices - applied to `gpt-5.6-luna` token counts, and that was the only cost figure in the app.
 *
 * Prices are configuration, not a constant: they change, and guessing one produces a number that
 * looks authoritative and is not. Both come from the shared root `.env`, and when either is
 * missing every cost in the UI renders as unavailable rather than as a wrong figure.
 *
 *   PUBLIC_MODEL_PRICE_IN_PER_MTOK=<usd per 1M input tokens>
 *   PUBLIC_MODEL_PRICE_OUT_PER_MTOK=<usd per 1M output tokens>
 *
 * They are `PUBLIC_` because cost is rendered client-side on the stats bar and the runs page.
 */
import {
  PUBLIC_MODEL_PRICE_IN_PER_MTOK,
  PUBLIC_MODEL_PRICE_OUT_PER_MTOK
} from "$app/env/public";

/** The model these prices describe. Kept beside them so a model swap is visibly a price change. */
export const COST_MODEL = "gpt-5.6-luna";

function price(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export const PRICE_IN_PER_MTOK = price(PUBLIC_MODEL_PRICE_IN_PER_MTOK);
export const PRICE_OUT_PER_MTOK = price(PUBLIC_MODEL_PRICE_OUT_PER_MTOK);

/** False until both prices are configured. The UI hides cost rather than inventing one. */
export const PRICING_CONFIGURED = PRICE_IN_PER_MTOK !== null && PRICE_OUT_PER_MTOK !== null;

export const PRICING_HINT =
  `Set PUBLIC_MODEL_PRICE_IN_PER_MTOK and PUBLIC_MODEL_PRICE_OUT_PER_MTOK for ${COST_MODEL} in .env to show cost.`;

export function costUsd(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number | null {
  if (!PRICING_CONFIGURED) return null;
  if (tokensIn == null && tokensOut == null) return null;
  return (tokensIn ?? 0) / 1_000_000 * PRICE_IN_PER_MTOK! + (tokensOut ?? 0) / 1_000_000 * PRICE_OUT_PER_MTOK!;
}
