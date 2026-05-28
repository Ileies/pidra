import { loadConfig } from "./config";
import {
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  makeInitialCheckpoint,
  type CheckpointState,
} from "./checkpoint";
import { loadErrors, logError, getErrors } from "./errors";
import { startProgress, updateProgress, stopProgress, pauseProgress, resumeProgress } from "./progress";
import { fetchEmailItems, type EmailItem } from "./sources/email";
import { fetchTaskItems } from "./sources/tasks";
import { fetchKeepNotes } from "./sources/keep";
import { fetchGitHubRepos } from "./sources/github";
import { extractEmails } from "./pipeline/extract-email";
import { extractNotes } from "./pipeline/extract-note";
import { batchContacts } from "./pipeline/batch-contacts";
import {
  synthesizeContacts,
  synthesizeTasks,
  synthesizeKeep,
  synthesizeGitHub,
  synthesizeFullContext,
  synthesizePatch,
  type SynthesisResult,
} from "./pipeline/synthesize";
import { seedContacts, seedEntities, seedStandingContext } from "./output/db-writer";
import { writeOutputFiles } from "./output/builder";
import { db } from "../src/db";
import { contextBuilderRuns, contextBuilderIndexedItems } from "../src/db/schema";
import { eq, count } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const forceFull = args.includes("--full");
const forceUpdate = args.includes("--update");
const dryRun = args.includes("--dry-run");

async function detectMode(): Promise<"full" | "update" | "resume"> {
  const cp = await loadCheckpoint();
  if (cp && cp.runId && !forceFull) {
    console.log(`[run] Resuming interrupted run ${cp.runId}`);
    return "resume";
  }
  if (forceFull) return "full";

  const [lastRun] = await db
    .select()
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(contextBuilderRuns.startedAt)
    .limit(1);

  return (lastRun || forceUpdate) ? "update" : "full";
}

async function getSkipSet(source: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: contextBuilderIndexedItems.itemId })
    .from(contextBuilderIndexedItems)
    .where(eq(contextBuilderIndexedItems.source, source));
  return new Set(rows.map((r) => r.itemId));
}

async function getTotalIndexedCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(contextBuilderIndexedItems);
  return Number(row?.n ?? 0);
}

function printInventory(info: {
  emailNew: number; emailSkipped: number;
  tasks: number;
  keepNew: number; keepSkipped: number;
  github: number;
  mode: string;
}): void {
  const col = (s: string, w: number) => s.padEnd(w);
  console.log("\n=== Source Inventory ===");
  if (info.mode === "update") {
    console.log(`  ${col("Email", 10)} ${info.emailNew} new  (${info.emailSkipped} already indexed)`);
    console.log(`  ${col("Tasks", 10)} ${info.tasks} (always re-fetched)`);
    console.log(`  ${col("Keep", 10)} ${info.keepNew} new  (${info.keepSkipped} already indexed)`);
  } else {
    console.log(`  ${col("Email", 10)} ${info.emailNew}`);
    console.log(`  ${col("Tasks", 10)} ${info.tasks}`);
    console.log(`  ${col("Keep", 10)} ${info.keepNew}`);
  }
  console.log(`  ${col("GitHub", 10)} ${info.github} repos (always re-fetched)`);
  console.log("========================\n");
}

async function main(): Promise<void> {
  const config = loadConfig();
  await loadErrors();

  const mode = await detectMode();
  const today = new Date().toISOString().split("T")[0];
  const runId = `cb-${today}-${Date.now()}`;

  console.log(`\n=== Context Builder - ${mode} mode${dryRun ? " (dry run)" : ""} ===\n`);

  let dbRunId: string | undefined;
  if (!dryRun) {
    const [runRow] = await db
      .insert(contextBuilderRuns)
      .values({ mode, status: "running" })
      .returning({ id: contextBuilderRuns.id });
    dbRunId = runRow.id;
  }

  const state: CheckpointState = makeInitialCheckpoint(runId, mode === "resume" ? "update" : mode);
  if (!dryRun) await saveCheckpoint(state);
  startProgress(state);

  // === FETCH PHASE ===

  let allEmailItems: EmailItem[] = [];
  let emailSkipped = 0;
  let emailSkipSet = new Set<string>();

  try {
    emailSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("email");
    for (const account of config.emailAccounts) {
      if (account.isNewsAccount) continue;
      const { items, skipped } = await fetchEmailItems(account, config.emailYears, emailSkipSet);
      allEmailItems.push(...items);
      emailSkipped += skipped;
    }
    state.phases.email.total = allEmailItems.length;
    state.phases.email.skipped = emailSkipped;
  } catch (err) {
    await logError("phase:email-fetch", err);
  }
  updateProgress(state);

  let taskItems: Awaited<ReturnType<typeof fetchTaskItems>> = [];
  try {
    taskItems = await fetchTaskItems();
    state.phases.tasks.total = taskItems.length;
    state.phases.tasks.done = true;
  } catch (err) {
    await logError("phase:tasks-fetch", err);
    state.phases.tasks.done = true;
  }
  updateProgress(state);

  let keepNotes: Awaited<ReturnType<typeof fetchKeepNotes>> = [];
  let keepSkipSet = new Set<string>();
  let keepNewCount = 0;

  try {
    keepSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("keep");
    keepNotes = await fetchKeepNotes();
    keepNewCount = keepNotes.filter((n) => !keepSkipSet.has(n.id)).length;
    state.phases.keep.total = keepNewCount;
    state.phases.keep.skipped = keepSkipSet.size;
  } catch (err) {
    await logError("phase:keep-fetch", err);
  }
  updateProgress(state);

  let githubRepos: Awaited<ReturnType<typeof fetchGitHubRepos>> = [];
  try {
    if (config.githubToken) {
      githubRepos = await fetchGitHubRepos(config.githubToken);
    }
    state.phases.github.total = githubRepos.length;
    state.phases.github.done = true;
  } catch (err) {
    await logError("phase:github-fetch", err);
    state.phases.github.done = true;
  }
  updateProgress(state);

  // === INVENTORY TABLE ===
  pauseProgress();
  printInventory({
    emailNew: allEmailItems.length,
    emailSkipped,
    tasks: taskItems.length,
    keepNew: keepNewCount,
    keepSkipped: keepSkipSet.size,
    github: githubRepos.length,
    mode,
  });

  // === 30% DELTA WARNING (update mode only) ===
  if (mode === "update") {
    const totalIndexed = await getTotalIndexedCount();
    if (totalIndexed > 0) {
      const delta = allEmailItems.length + keepNewCount;
      const ratio = delta / totalIndexed;
      if (ratio > 0.3) {
        console.warn(`WARNING: Delta (${delta} items) is ${Math.round(ratio * 100)}% of existing index (${totalIndexed} items).`);
        console.warn(`Consider running with --full for a cleaner result. Proceeding with update anyway.\n`);
      }
    }
  }

  if (dryRun) {
    if (dbRunId) {
      await db.update(contextBuilderRuns)
        .set({ status: "completed", completedAt: new Date().toISOString(), itemsIndexed: 0 })
        .where(eq(contextBuilderRuns.id, dbRunId));
    }
    await clearCheckpoint();
    return;
  }

  resumeProgress(state);

  // === EXTRACTION PHASE ===

  let emailExtractions: Awaited<ReturnType<typeof extractEmails>> = [];
  try {
    if (allEmailItems.length > 0) {
      emailExtractions = await extractEmails(allEmailItems, dbRunId!, config.ollamaModel, (done) => {
        state.phases.email.processed = done;
        updateProgress(state);
      });
    }
  } catch (err) {
    await logError("phase:email-extract", err);
  } finally {
    state.phases.email.done = true;
    await saveCheckpoint(state);
    updateProgress(state);
  }

  let noteExtractions: Awaited<ReturnType<typeof extractNotes>> = [];
  try {
    if (keepNotes.length > 0) {
      noteExtractions = await extractNotes(keepNotes, dbRunId!, config.ollamaModel, keepSkipSet, (done) => {
        state.phases.keep.processed = done;
        updateProgress(state);
      });
    }
  } catch (err) {
    await logError("phase:keep-extract", err);
  } finally {
    state.phases.keep.done = true;
    await saveCheckpoint(state);
    updateProgress(state);
  }

  // === SYNTHESIS PHASE (always runs with whatever data is available) ===

  const contactProfiles = batchContacts(emailExtractions);
  const notesByCategory = noteExtractions.reduce((map, n) => {
    const arr = map.get(n.category) ?? [];
    arr.push(n);
    map.set(n.category, arr);
    return map;
  }, new Map<string, typeof noteExtractions>());

  let parts: Omit<SynthesisResult, "fullContext"> = { contacts: "", tasks: "", keep: "", github: "" };
  let fullContext = "";

  try {
    const [contactsSummary, tasksSummary, keepSummary, githubSummary] = await Promise.allSettled([
      emailExtractions.length > 0 ? synthesizeContacts(contactProfiles) : Promise.resolve("No email data"),
      taskItems.length > 0 ? synthesizeTasks(taskItems) : Promise.resolve("No task data"),
      noteExtractions.length > 0 ? synthesizeKeep(notesByCategory) : Promise.resolve("No Keep data"),
      githubRepos.length > 0 ? synthesizeGitHub(githubRepos) : Promise.resolve("No GitHub data"),
    ]);

    parts = {
      contacts: contactsSummary.status === "fulfilled" ? contactsSummary.value : "",
      tasks: tasksSummary.status === "fulfilled" ? tasksSummary.value : "",
      keep: keepSummary.status === "fulfilled" ? keepSummary.value : "",
      github: githubSummary.status === "fulfilled" ? githubSummary.value : "",
    };

    if (mode === "update") {
      const [lastRun] = await db
        .select({ outputPath: contextBuilderRuns.outputPath, itemsIndexed: contextBuilderRuns.itemsIndexed })
        .from(contextBuilderRuns)
        .where(eq(contextBuilderRuns.status, "completed"))
        .orderBy(contextBuilderRuns.startedAt)
        .limit(1);

      let existingContext = "";
      if (lastRun?.outputPath) {
        try {
          const prevJson = JSON.parse(await readFile(lastRun.outputPath, "utf-8")) as { fullContext?: string };
          existingContext = prevJson.fullContext ?? "";
        } catch {}
      }

      const existingCount = lastRun?.itemsIndexed ?? 0;
      const deltaCount = emailExtractions.length + noteExtractions.length + githubRepos.length;

      fullContext = existingContext
        ? await synthesizePatch(existingContext, parts, { existing: existingCount, delta: deltaCount })
        : await synthesizeFullContext(parts);
    } else {
      fullContext = await synthesizeFullContext(parts);
    }
  } catch (err) {
    await logError("phase:synthesis", err);
  }

  state.phases.synthesis.done = true;
  updateProgress(state);

  // === OUTPUT FILES ===
  let jsonPath = "";
  let mdPath = "";
  try {
    const paths = await writeOutputFiles(
      { ...parts, fullContext },
      config.outputDir,
      today,
    );
    jsonPath = paths.jsonPath;
    mdPath = paths.mdPath;
  } catch (err) {
    await logError("phase:output", err);
  }

  // === DB SEEDING ===
  try {
    await seedContacts(contactProfiles);
    await seedEntities(emailExtractions, noteExtractions);
    await seedStandingContext(noteExtractions);
  } catch (err) {
    await logError("phase:db-seed", err);
  }

  state.phases.dbSeed.done = true;
  updateProgress(state);

  // === FINALIZE ===
  const totalIndexed = emailExtractions.length + noteExtractions.length + githubRepos.length + taskItems.length;

  if (dbRunId) {
    await db
      .update(contextBuilderRuns)
      .set({ status: "completed", completedAt: new Date().toISOString(), itemsIndexed: totalIndexed, outputPath: jsonPath || null })
      .where(eq(contextBuilderRuns.id, dbRunId));
  }

  await clearCheckpoint();
  stopProgress();

  const errors = getErrors();
  console.log(`\nContext Builder complete!`);
  console.log(`  Items indexed : ${totalIndexed}`);
  if (mdPath) console.log(`  Output        : ${mdPath}`);
  if (errors.length > 0) console.log(`  Errors logged : ${errors.length} (see context-builder/errors.json)`);
}

main().catch(async (err) => {
  console.error("\nContext Builder failed:", err);
  process.exit(1);
});
