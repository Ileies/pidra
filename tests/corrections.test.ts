// Protects src/context/corrections.ts: recording and reverting corrections (locks, previous-state
// snapshots, 409 on repeat). The db is a recording mock; assertions read the captured writes.
import { beforeEach, expect, mock, test } from "bun:test";
import * as schema from "../src/db/schema";

type Write = { table: unknown; values: Record<string, unknown> };

let tables = new Map<unknown, Record<string, unknown>[]>();
let updates: Write[] = [];
let inserts: Write[] = [];

const db = {
  select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => tables.get(table) ?? [] }) }) }),
  update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: async () => { updates.push({ table, values }); } }) }),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      inserts.push({ table, values });
      const done = { returning: async () => [{ id: "new-correction" }] };
      return Object.assign(Promise.resolve(), done);
    },
  }),
};

mock.module("../src/db", () => ({ ...schema, db }));
const { revertCorrection, recordCorrection, addContact, CorrectionError } = await import("../src/context/corrections?corrections-test");

const correction = (over: Record<string, unknown>) => ({
  id: "c1",
  status: "active",
  targetKind: "document",
  targetKey: "heading",
  previousState: null,
  ...over,
});

const only = (table: unknown) => updates.filter((u) => u.table === table);

beforeEach(() => {
  tables = new Map();
  updates = [];
  inserts = [];
});

test("reverting a document correction only flips its status", async () => {
  tables.set(schema.contextCorrections, [correction({})]);
  expect(await revertCorrection("c1")).toBe("Correction c1 reverted.");
  expect(updates).toHaveLength(1);
  expect(updates[0].table).toBe(schema.contextCorrections);
  expect(updates[0].values.status).toBe("reverted");
  expect("revertedAt" in updates[0].values).toBe(true);
});

test("reverting an edited contact puts the previous fields back, locked state included", async () => {
  tables.set(schema.contextCorrections, [correction({
    targetKind: "contact",
    targetKey: "a@example.com",
    previousState: { name: "A", relationship: "friend", priority: "high", contextNotes: null, removedAt: null, locked: false },
  })]);
  expect(await revertCorrection("c1")).toBe("Correction c1 reverted, contact a@example.com restored.");
  const [restore] = only(schema.contacts);
  expect(restore.values).toMatchObject({ name: "A", relationship: "friend", priority: "high", contextNotes: null, removedAt: null, locked: false });
  expect("updatedAt" in restore.values).toBe(true);
  expect(only(schema.contextCorrections)[0].values.status).toBe("reverted");
});

test("reverting an added contact takes it out of use again instead of restoring a row", async () => {
  tables.set(schema.contextCorrections, [correction({
    targetKind: "contact",
    targetKey: "a@example.com",
    previousState: { __created: true },
  })]);
  expect(await revertCorrection("c1")).toBe("Correction c1 reverted, contact a@example.com removed again.");
  const [removed] = only(schema.contacts);
  expect(Object.keys(removed.values).sort()).toEqual(["removedAt", "updatedAt"]);
});

test("reverting an entity correction restores the entity row by id", async () => {
  tables.set(schema.contextCorrections, [correction({
    targetKind: "entity",
    targetKey: "Acme",
    previousState: { id: "e1", type: "org", domain: null, summary: "S", importance: "normal", status: "active", locked: false },
  })]);
  expect(await revertCorrection("c1")).toBe("Correction c1 reverted, entity Acme restored.");
  const [restore] = only(schema.entities);
  expect(restore.values).toEqual({ type: "org", domain: null, summary: "S", importance: "normal", status: "active", locked: false });
});

test("a missing or already reverted correction cannot be reverted, and answers 409", async () => {
  await expect(revertCorrection("nope")).rejects.toMatchObject({ status: 409 });
  tables.set(schema.contextCorrections, [correction({ status: "reverted" })]);
  await expect(revertCorrection("c1")).rejects.toBeInstanceOf(CorrectionError);
  expect(updates).toHaveLength(0);
});

test("correcting a contact field merges it, locks the row and snapshots the previous row", async () => {
  const row = { identifier: "a@example.com", name: "A", relationship: "colleague", priority: "normal", contextNotes: null, removedAt: null };
  tables.set(schema.contacts, [row]);
  const result = await recordCorrection({
    targetKind: "contact",
    targetKey: "a@example.com",
    operation: "amend",
    statement: "A is a friend.",
    fields: { relationship: "friend", name: "A" },
  });
  expect(result.applied).toContain("updated contact a@example.com: relationship");
  const [merge] = only(schema.contacts);
  expect(merge.values).toMatchObject({ relationship: "friend", locked: true });
  expect("name" in merge.values).toBe(false);
  const [saved] = inserts.filter((i) => i.table === schema.contextCorrections);
  expect(saved.values.previousState).toBe(row);
});

test("a correction whose fields change nothing is recorded without touching the row", async () => {
  tables.set(schema.entities, [{ id: "e1", name: "Acme", status: "active", importance: "normal" }]);
  const result = await recordCorrection({
    targetKind: "entity",
    targetKey: "acme",
    operation: "amend",
    statement: "Acme is normal.",
    fields: { importance: "normal" },
  });
  expect(result.applied).toContain("no entity field actually changed");
  expect(updates).toHaveLength(0);
  expect(inserts.at(-1)!.values.previousState).toBeNull();
});

test("removing an entity archives and locks it, and an unknown field is rejected", async () => {
  tables.set(schema.entities, [{ id: "e1", name: "Acme", status: "active" }]);
  await recordCorrection({ targetKind: "entity", targetKey: "Acme", operation: "retract", statement: "Drop Acme.", remove: true });
  expect(only(schema.entities)[0].values).toEqual({ status: "archived", locked: true });

  await expect(
    recordCorrection({ targetKind: "entity", targetKey: "Acme", operation: "amend", statement: "x", fields: { name: "Other" } }),
  ).rejects.toThrow('field "name" cannot be corrected on a entity');
});

test("adding a contact creates a locked row marked as created, and a repeat is refused", async () => {
  const added = await addContact({ identifier: "New@Example.com", name: "New" });
  expect(added.applied).toBe("added contact new@example.com (locked against re-seed)");
  expect(inserts.find((i) => i.table === schema.contacts)!.values).toMatchObject({ identifier: "new@example.com", locked: true, priority: "normal" });
  expect(inserts.find((i) => i.table === schema.contextCorrections)!.values.previousState).toEqual({ __created: true });

  tables.set(schema.contacts, [{ identifier: "new@example.com", removedAt: null }]);
  await expect(addContact({ identifier: "new@example.com" })).rejects.toThrow("already exists");
});
