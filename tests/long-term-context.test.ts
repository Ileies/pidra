// Protects the "# 1." to "# 5." interface between the Context Builder and the daily synthesis
// prompts (CLAUDE.md): `pickSections` routes sections by number, and a document in any other shape
// must reach synthesis as an empty string, never as a crash or as the wrong sections. Also pins
// `loadLongTermContext`'s fallback past a patch document (the 2026-09-11 incident). The db is a mock.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "../src/db/schema";
import { dbModule } from "./fixtures/db";

type Run = { document: unknown; outputPath: string | null; completedAt: Date | null };

let runs: Run[] = [];
let dbDown = false;

const query = (rows: () => unknown[]) => {
  const chain: Record<string, unknown> = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (rows: unknown[]) => void) => resolve(rows()),
  };
  return chain;
};

const db = {
  select: () => ({
    from: (table: unknown) => query(() => {
      if (dbDown) throw new Error("db down");
      return table === schema.contextBuilderRuns ? runs : [];
    }),
  }),
};

mock.module("../src/db", () => dbModule(db));
const { pickSections, loadLongTermContext, shareLongTermContext } = await import("../src/pipeline/long-term-context?long-term-context-test");

const FULL = [
  "Preamble the builder never writes but a model might.",
  "# 1. Identity & Relationships",
  "alpha",
  "## Sub heading stays inside its parent",
  "# 2. Commitments",
  "bravo",
  "# 3. Interests",
  "charlie",
  "# 4. Standing context",
  "delta",
  "# 5. Technical profile",
  "echo",
].join("\n");

beforeEach(() => {
  runs = [];
  dbDown = false;
});

test("picks the wanted sections in document order, whatever order the spec lists them", () => {
  const picked = pickSections(FULL, "5,1");
  expect(picked.indexOf("alpha")).toBeGreaterThanOrEqual(0);
  expect(picked.indexOf("alpha")).toBeLessThan(picked.indexOf("echo"));
  expect(picked).not.toContain("bravo");
  expect(picked).not.toContain("charlie");
  expect(picked).not.toContain("delta");
});

test("keeps the heading and the sub-headings with their section, and drops the preamble", () => {
  const picked = pickSections(FULL, "1");
  expect(picked.startsWith("# 1. Identity & Relationships")).toBe(true);
  expect(picked).toContain("## Sub heading stays inside its parent");
  expect(picked).not.toContain("Preamble");
  expect(picked).not.toContain("# 2.");
});

test("a spec tolerates spaces and empty entries", () => {
  expect(pickSections(FULL, " 2 , 3 ,, ")).toBe(pickSections(FULL, "2,3"));
  expect(pickSections(FULL, "2,3")).toContain("bravo");
  expect(pickSections(FULL, "2,3")).toContain("charlie");
});

test("returns an empty string for an empty spec or an empty document", () => {
  expect(pickSections(FULL, "")).toBe("");
  expect(pickSections(FULL, " , ")).toBe("");
  expect(pickSections("", "1,2")).toBe("");
});

test("a section number that is not in the document yields nothing, not another section", () => {
  expect(pickSections(FULL, "6")).toBe("");
  expect(pickSections(FULL, "9,10")).toBe("");
});

test("section 1 does not match section 10", () => {
  const doc = "# 10. Appendix\nzulu\n# 1. Identity\nalpha";
  const picked = pickSections(doc, "1");
  expect(picked).toContain("alpha");
  expect(picked).not.toContain("zulu");
});

test("an update-mode patch document, in any other shape, routes to an empty string", () => {
  const patch = "# Updated Personal Context\n## 1. Something changed\nbody\n## 3. Something else\nmore";
  expect(pickSections(patch, "1,2,4")).toBe("");
  expect(pickSections(patch, "3,5")).toBe("");
});

test("a document with unnumbered or differently shaped headings routes to an empty string", () => {
  const doc = "# Identity\nalpha\n# Interests\ncharlie\n# One. Not a number\nbravo\n# 4 No dot after the number\ndelta\n# 5: Colon instead\necho";
  expect(pickSections(doc, "1,2,3,4,5")).toBe("");
});

test("the default routes cover each of the five sections exactly once between intel and personal", async () => {
  runs = [{ document: { fullContext: FULL, generatedAt: "2026-09-10T05:00:00Z" }, outputPath: null, completedAt: null }];
  const ctx = await loadLongTermContext();

  expect(ctx.problem).toBeNull();
  for (const [marker, in_] of [["alpha", "personal"], ["bravo", "personal"], ["delta", "personal"], ["charlie", "intel"], ["echo", "intel"]] as const) {
    expect(ctx.personalSections.includes(marker)).toBe(in_ === "personal");
    expect(ctx.intelSections.includes(marker)).toBe(in_ === "intel");
  }
  expect(ctx.interestSections).toContain("charlie");
  expect(ctx.interestSections).not.toContain("echo");
  expect(ctx.generatedAt).toBe("2026-09-10T05:00:00Z");
});

test("falls back past a newer patch document to the older full harvest and says so", async () => {
  runs = [
    { document: { fullContext: "# Updated Personal Context\n## 1. changed\nbody", generatedAt: "2026-09-11T05:00:00Z" }, outputPath: null, completedAt: null },
    { document: { fullContext: FULL, generatedAt: "2026-09-10T05:00:00Z" }, outputPath: null, completedAt: null },
  ];
  const ctx = await loadLongTermContext();

  expect(ctx.personalSections).toContain("alpha");
  expect(ctx.generatedAt).toBe("2026-09-10T05:00:00Z");
  expect(ctx.problem).toContain("fell back past 1 run(s)");
  expect(ctx.problem).toContain("yielded no usable sections");
});

test("reports a problem and empty sections when no run exists", async () => {
  const ctx = await loadLongTermContext();
  expect(ctx.problem).toBe("no completed Context Builder run");
  expect([ctx.intelSections, ctx.personalSections, ctx.interestSections]).toEqual(["", "", ""]);
  expect(ctx.generatedAt).toBeNull();
});

test("reports a problem and empty sections when no recent run yields a usable document", async () => {
  runs = [
    { document: { fullContext: "# Updated Personal Context\n## 1. changed", generatedAt: "x" }, outputPath: null, completedAt: null },
    { document: null, outputPath: null, completedAt: null },
    { document: { fullContext: "", generatedAt: "x" }, outputPath: null, completedAt: null },
  ];
  const ctx = await loadLongTermContext();

  expect(ctx.problem).toContain("no usable context document in the last 3 run(s)");
  expect(ctx.problem).toContain("a completed run recorded no document");
  expect([ctx.intelSections, ctx.personalSections, ctx.interestSections]).toEqual(["", "", ""]);
});

test("a failed load is not cached by shareLongTermContext, so a retry reads again", async () => {
  const load = shareLongTermContext();

  dbDown = true;
  await expect(load()).rejects.toThrow("db down");
  dbDown = false;
  const first = await load();
  expect(first.problem).toBe("no completed Context Builder run");
  expect(await load()).toBe(first);
});

let dir: string | null = null;
afterEach(async () => {
  delete process.env.CONTEXT_BUILDER_OUTPUT_DIR;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

test("a legacy row with only an output path reads the archive by name from this machine's output dir", async () => {
  dir = await mkdtemp(join(tmpdir(), "pidra-ltc-"));
  await writeFile(join(dir, "harvest.json"), JSON.stringify({ fullContext: FULL, generatedAt: "2026-08-01T05:00:00Z" }));
  process.env.CONTEXT_BUILDER_OUTPUT_DIR = dir;
  runs = [{ document: null, outputPath: "/home/someone-else/pidra/context-builder/output/harvest.json", completedAt: null }];

  const ctx = await loadLongTermContext();

  expect(ctx.problem).toBeNull();
  expect(ctx.personalSections).toContain("alpha");
  expect(ctx.generatedAt).toBe("2026-08-01T05:00:00Z");
});

test("a legacy row whose archive is missing everywhere is a problem, not a crash", async () => {
  dir = await mkdtemp(join(tmpdir(), "pidra-ltc-"));
  process.env.CONTEXT_BUILDER_OUTPUT_DIR = dir;
  runs = [{ document: null, outputPath: "/gone/harvest.json", completedAt: null }];

  const ctx = await loadLongTermContext();

  expect(ctx.problem).toContain("harvest.json");
  expect(ctx.personalSections).toBe("");
});
