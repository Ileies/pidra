import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { SynthesisResult } from "../pipeline/synthesize";

export async function writeOutputFiles(
  result: SynthesisResult,
  outputDir: string,
  date: string,
): Promise<{ jsonPath: string; mdPath: string }> {
  await mkdir(outputDir, { recursive: true });

  const jsonPath = resolve(outputDir, `context-${date}.json`);
  const mdPath = resolve(outputDir, `context-${date}.md`);

  const jsonOutput = {
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

Generated: ${new Date().toLocaleString("de-DE")}

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

  return { jsonPath, mdPath };
}
