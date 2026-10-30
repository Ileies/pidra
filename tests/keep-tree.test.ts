import { describe, expect, test } from "bun:test";
import { KeepTree, type RawNode } from "../context-builder/sources/keep-tree";

const TS = { updated: "2024-01-02T03:04:05.123Z" };

function note(id: string, extra: Partial<RawNode> = {}): RawNode {
  return { id, type: "NOTE", parentId: "root", timestamps: TS, ...extra };
}
function item(id: string, parentId: string, extra: Partial<RawNode> = {}): RawNode {
  return { id, type: "LIST_ITEM", parentId, timestamps: TS, ...extra };
}

describe("KeepTree", () => {
  test("a note's body lives in its first list-item child", () => {
    const tree = new KeepTree();
    tree.applyNodes([note("n1", { title: "Shopping", text: "ignored" }), item("i1", "n1", { text: "milk" })]);
    expect(tree.notes()).toEqual([
      { id: "n1", title: "Shopping", text: "milk", labels: [], isPinned: false, isArchived: false, updatedAt: "2024-01-02T03:04:05.123000+00:00" },
    ]);
  });

  test("a note without a child falls back to its own text", () => {
    const tree = new KeepTree();
    tree.applyNodes([note("n1", { text: "own text" })]);
    expect(tree.notes()[0]!.text).toBe("own text");
  });

  test("lists render highest sort first, checked boxes, indented children under their parent", () => {
    const tree = new KeepTree();
    tree.applyNodes([
      { id: "l1", type: "LIST", parentId: "root", timestamps: TS },
      item("a", "l1", { text: "first", sortValue: "300" }),
      item("b", "l1", { text: "second", sortValue: "200", checked: true }),
      item("c", "l1", { text: "child of first", sortValue: "50", superListItemId: "a" }),
      item("d", "l1", { text: "third", sortValue: "100" }),
    ]);
    expect(tree.notes()[0]!.text).toBe(["☐ first", "  ☐ child of first", "☑ second", "☐ third"].join("\n"));
  });

  test("a deleted list item is left out of a list", () => {
    const tree = new KeepTree();
    tree.applyNodes([
      { id: "l1", type: "LIST", parentId: "root", timestamps: TS },
      item("a", "l1", { text: "kept", sortValue: 2 }),
      item("b", "l1", { text: "gone", sortValue: 1, timestamps: { ...TS, deleted: "2024-02-01T00:00:00.000Z" } }),
    ]);
    expect(tree.notes()[0]!.text).toBe("☐ kept");
  });

  test("epoch-zero deleted means not deleted", () => {
    const tree = new KeepTree();
    tree.applyNodes([
      { id: "l1", type: "LIST", parentId: "root", timestamps: TS },
      item("a", "l1", { text: "kept", timestamps: { ...TS, deleted: "1970-01-01T00:00:00.000Z" } }),
    ]);
    expect(tree.notes()[0]!.text).toBe("☐ kept");
  });

  test("labels resolve against the final label set and unknown ids are dropped", () => {
    const tree = new KeepTree();
    tree.applyNodes([note("n1", { labelIds: [{ labelId: "t1" }, { labelId: "t2" }, { labelId: "gone" }] })]);
    tree.setLabels([{ mainId: "t1", name: "Credentials" }, { mainId: "t2", name: "Ideas" }]);
    expect(tree.notes()[0]!.labels).toEqual(["Credentials", "Ideas"]);
  });

  test("pinned, archived and trashed notes keep their flags and stay in the output", () => {
    const tree = new KeepTree();
    tree.applyNodes([note("n1", { isPinned: true, isArchived: true, timestamps: { ...TS, trashed: "2024-03-01T00:00:00.000Z" } as RawNode["timestamps"] })]);
    expect(tree.notes()[0]).toMatchObject({ id: "n1", isPinned: true, isArchived: true });
  });

  test("a node without parentId deletes the known node; later pages update in place", () => {
    const tree = new KeepTree();
    tree.applyNodes([note("n1", { title: "old" }), note("n2")]);
    tree.applyNodes([note("n1", { title: "new" }), { id: "n2" }]);
    expect(tree.notes().map((n) => [n.id, n.title])).toEqual([["n1", "new"]]);
  });

  test("unknown node types and tombstones for unknown nodes are ignored", () => {
    const tree = new KeepTree();
    tree.applyNodes([{ id: "x", type: "MYSTERY", parentId: "root", timestamps: TS }, { id: "ghost" }, note("n1")]);
    expect(tree.notes().map((n) => n.id)).toEqual(["n1"]);
  });

  test("updatedAt matches Python isoformat: fraction omitted when zero, microsecond padded", () => {
    const tree = new KeepTree();
    tree.applyNodes([
      note("a", { timestamps: { updated: "2024-01-02T03:04:05.000Z" } }),
      note("b", { timestamps: { updated: "2024-01-02T03:04:05.5Z" } }),
      note("c", { timestamps: { updated: "2024-01-02T03:04:05.123456Z" } }),
    ]);
    expect(tree.notes().map((n) => n.updatedAt)).toEqual([
      "2024-01-02T03:04:05+00:00",
      "2024-01-02T03:04:05.500000+00:00",
      "2024-01-02T03:04:05.123456+00:00",
    ]);
  });

  test("output keeps the server's order", () => {
    const tree = new KeepTree();
    tree.applyNodes([note("z"), note("a"), note("m")]);
    expect(tree.notes().map((n) => n.id)).toEqual(["z", "a", "m"]);
  });

  test("a node without an updated timestamp is an error, as in gkeepapi", () => {
    const tree = new KeepTree();
    expect(() => tree.applyNodes([{ id: "n1", type: "NOTE", parentId: "root" }])).toThrow("updated");
  });
});
