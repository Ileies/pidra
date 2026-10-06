// forModel keeps the entity graph out of model payloads without touching the stored row.
import { expect, test } from "bun:test";
import { forModel } from "../src/util/extracted";

test("forModel drops entities_graph and keeps the claim fields", () => {
  const stored = { headline: "H", entities_graph: { entities: [{ name: "Acme" }] } };
  expect(forModel(stored)).toEqual({ headline: "H" });
  expect(stored.entities_graph).toBeDefined();
  expect(forModel(null)).toEqual({});
});
