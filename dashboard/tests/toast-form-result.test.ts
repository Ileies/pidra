import { expect, test } from "bun:test";
import { render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import Page from "../src/routes/settings/newsletters/+page.svelte";
import { toasts } from "../src/lib/toast.svelte.js";

const feeds = [
  { sourceName: "A", url: "https://example.com/a", lastError: null, lastErrorAt: null, lastSuccessAt: null },
  { sourceName: "B", url: "https://example.com/b", lastError: null, lastErrorAt: null, lastSuccessAt: null },
];

test("two consecutive form results do not loop", () => {
  const view = render(Page, { props: { data: { feeds }, form: null } } as never);
  view.rerender({ data: { feeds }, form: { message: "first" } } as never);
  flushSync();
  expect(toasts.items.length).toBe(1);
  view.rerender({ data: { feeds: [feeds[1]] }, form: { message: "second" } } as never);
  flushSync();
  expect(toasts.items.length).toBe(2);
});
