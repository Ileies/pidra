// Built from escaped strings rather than literal characters so this source stays pure ASCII:
// a lone surrogate or a raw control byte pasted into a source file is invisible and fragile.
const LONE_HIGH_SURROGATE = new RegExp("[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])", "g");
const LONE_LOW_SURROGATE = new RegExp("(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]", "g");
// C0 controls and DEL, keeping tab (09), newline (0A) and carriage return (0D).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/**
 * Removes unpaired UTF-16 surrogates and stray control bytes.
 *
 * Both ends of the pipeline need this. Inbound: real mail and newsletter HTML contains these
 * bytes, and they survive JSON.stringify as escapes the OpenAI API rejects with "Invalid body:
 * failed to parse JSON value". Outbound: a model once emitted an entity name with NUL bytes as
 * separators, and Postgres rejects 0x00 in `text` with `invalid byte sequence for encoding
 * "UTF8"` - which failed a whole batch insert on account of one row.
 */
export function stripControlChars(text: string): string {
  return text
    .replace(LONE_HIGH_SURROGATE, "")
    .replace(LONE_LOW_SURROGATE, "")
    .replace(CONTROL_CHARS, "");
}
