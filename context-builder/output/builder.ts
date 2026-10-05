// Archival output: context-YYYY-MM-DD.json and .md in config.outputDir (called by phases/finalize.ts).
// The returned `document` is what finalizeRun stores in context_builder_runs.document, the copy the
// daily pipeline actually reads; the files are for manual inspection only.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { SynthesisResult } from "../pipeline/synthesize";

/** Shape stored in context_builder_runs.document and in the .json file. `fullContext` must hold the `# 1.`-`# 5.` sections. */
export interface ContextDocument {
  generatedAt: string;
  date: string;
  contacts: string;
  tasks: string;
  keep: string;
  github: string;
  fullContext: string;
}

export async function writeOutputFiles(
  result: SynthesisResult,
  outputDir: string,
  date: string,
): Promise<{ jsonPath: string; mdPath: string; document: ContextDocument }> {
  await mkdir(outputDir, { recursive: true });

  const jsonPath = resolve(outputDir, `context-${date}.json`);
  const mdPath = resolve(outputDir, `context-${date}.md`);

  const jsonOutput: ContextDocument = {
    generatedAt: new Date().toISOString(),
    date,
    contacts: result.contacts,
    tasks: result.tasks,
    keep: result.keep,
    github: result.github,
    fullContext: result.fullContext,
  };

  await writeFile(jsonPath, JSON.stringify(jsonOutput, null, 2), "utf-8");

  const mdOutput = `# PIDRA Context Snapshot - ${date}

Generated: ${new Date().toISOString()}

---

## Full Context

${result.fullContext}

---

## Contacts Summary

${result.contacts}

---

## Active Commitments (Tasks)

${result.tasks}

---

## Personal Knowledge (Keep)

${result.keep}

---

## Technical Profile (GitHub)

${result.github}
`;

  await writeFile(mdPath, mdOutput, "utf-8");

  return { jsonPath, mdPath, document: jsonOutput };
}
