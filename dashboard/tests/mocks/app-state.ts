/**
 * Stub for `$app/state`. Real `page` is a reactive proxy SvelteKit's router provides; component
 * tests never navigate, so a plain object with a fixed URL is enough for a page that only reads
 * `page.url.searchParams` once at render.
 */

export const page = { url: new URL("http://localhost/topics") };
