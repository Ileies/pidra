// context-builder/phases/verified-document.ts: a patched document that breaks the `# 1.`-`# 5.`
// contract is rebuilt in full, a full build that still breaks it throws (so the run records no
// document and the last good harvest stays the newest), and a good one is returned untouched.
// The db is a mock, only here so importing run-tracking never reaches a real database.
import { expect, mock, test } from "bun:test";
import { dbModule } from "./fixtures/db";

mock.module("../src/db", () => dbModule({}));

const { buildVerifiedDocument } = await import("../context-builder/phases/verified-document");

const GOOD = ["# 1. Identity", "a", "# 2. Interests", "b", "# 3. Work", "c", "# 4. Commitments", "d", "# 5. Standing context", "e"].join("\n");
const PATCH_SHAPE = "# Updated Personal Context\n\n## 1. Topics that changed\nsomething";

function steps(over: { patch?: string | null; full?: string }) {
  const calls: string[] = [];
  const rejected: string[][] = [];
  return {
    calls,
    rejected,
    run: () =>
      buildVerifiedDocument({
        patch: over.patch === null || over.patch === undefined ? null : async () => (calls.push("patch"), over.patch!),
        full: async () => (calls.push("full"), over.full ?? GOOD),
        onPatchRejected: async (missing) => void rejected.push(missing),
      }),
  };
}

test("a well-formed patch is returned as is, with no second call", async () => {
  const patched = `${GOOD}\nmore`;
  const s = steps({ patch: patched });
  expect(await s.run()).toBe(patched);
  expect(s.calls).toEqual(["patch"]);
  expect(s.rejected).toEqual([]);
});

test("a patch that lost the headings is rebuilt in full, and the rejection names what was missing", async () => {
  const s = steps({ patch: PATCH_SHAPE });
  expect(await s.run()).toBe(GOOD);
  expect(s.calls).toEqual(["patch", "full"]);
  expect(s.rejected).toEqual([["1", "2", "3", "4", "5"]]);
});

test("a patch missing only one section is still rebuilt", async () => {
  const s = steps({ patch: GOOD.replace("# 3. Work\nc\n", "") });
  await s.run();
  expect(s.rejected).toEqual([["3"]]);
  expect(s.calls).toEqual(["patch", "full"]);
});

test("a rebuild that still breaks the contract throws instead of returning a document", async () => {
  const s = steps({ patch: PATCH_SHAPE, full: GOOD.replace("# 5. Standing context\ne", "") });
  await expect(s.run()).rejects.toThrow("synthesised document is missing section(s) 5");
  expect(s.calls).toEqual(["patch", "full"]);
});

test("without a previous document the full build runs directly and is verified", async () => {
  const ok = steps({ patch: null });
  expect(await ok.run()).toBe(GOOD);
  expect(ok.calls).toEqual(["full"]);
  expect(ok.rejected).toEqual([]);

  const bad = steps({ patch: null, full: "no headings at all" });
  await expect(bad.run()).rejects.toThrow("missing section(s) 1, 2, 3, 4, 5");
  expect(bad.rejected).toEqual([]);
});

test("an empty document fails the contract", async () => {
  await expect(steps({ patch: null, full: "" }).run()).rejects.toThrow("missing section(s)");
});

test("an error from the patch call propagates and the full build is not tried", async () => {
  const calls: string[] = [];
  await expect(
    buildVerifiedDocument({
      patch: async () => {
        throw new Error("model down");
      },
      full: async () => (calls.push("full"), GOOD),
      onPatchRejected: async () => {},
    }),
  ).rejects.toThrow("model down");
  expect(calls).toEqual([]);
});
