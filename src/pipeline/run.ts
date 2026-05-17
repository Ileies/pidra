import { runPhase2 } from "./phase2-extract";
import { runPhase3 } from "./phase3-context";
import { runPhase5 } from "./phase5-synthesis";
import { runPhase6 } from "./phase6-memory";

export async function runPipeline(runDate?: string): Promise<string> {
  const date = runDate ?? new Date().toISOString().split("T")[0];
  console.log(`\n=== PIDRA Pipeline — ${date} ===\n`);

  const start = Date.now();

  // Phase 1 ingestion must be run separately before calling this (or integrated)
  // Phase 2: Extract all raw items
  await runPhase2(date);

  // Phase 3: Assemble context (novelty, corroboration, entity lookup)
  const ctx = await runPhase3(date);

  // Phase 5: Synthesize both sections in parallel
  const synthesis = await runPhase5(ctx);

  // Phase 6: Write report + memory
  const report = await runPhase6(
    date,
    synthesis,
    ctx.newsletterItems.length + ctx.personalItems.length,
    ctx.newsletterItems.length
  );

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`\n=== Pipeline complete in ${elapsed}s ===\n`);

  return report;
}

// Run directly: bun run src/pipeline/run.ts
if (import.meta.main) {
  runPipeline().then((report) => {
    console.log("\n--- REPORT PREVIEW (first 500 chars) ---");
    console.log(report.slice(0, 500));
  }).catch(console.error);
}
