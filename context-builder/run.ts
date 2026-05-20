import { loadConfig } from "./config";
import {
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  makeInitialCheckpoint,
  type CheckpointState,
} from "./checkpoint";
import { loadErrors } from "./errors";
import { startProgress, updateProgress, stopProgress } from "./progress";
import { fetchEmailItems } from "./sources/email";
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
} from "./pipeline/synthesize";
import { seedContacts, seedEntities, seedStandingContext } from "./output/db-writer";
import { writeOutputFiles } from "./output/builder";
import { db } from "../src/db";
import { contextBuilderRuns, contextBuilderIndexedItems } from "../src/db/schema";
import { eq, and } from "drizzle-orm";
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

  return lastRun || forceUpdate ? "update" : "full";
}

async function getSkipSet(source: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: contextBuilderIndexedItems.itemId })
    .from(contextBuilderIndexedItems)
    .where(eq(contextBuilderIndexedItems.source, source));
  return new Set(rows.map((r) => r.itemId));
}

async function main(): Promise<void> {
  const config = await loadConfig();
  await loadErrors();

  const mode = await detectMode();
  const today = new Date().toISOString().split("T")[0];
  const runId = `cb-${today}-${Date.now()}`;

  console.log(`\n=== Context Builder — ${mode} mode${dryRun ? " (dry run)" : ""} ===\n`);

  // Insert run record
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

  try {
    // --- Phase 1: Email ---
    const emailSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("email");
    const allEmailItems: Awaited<ReturnType<typeof fetchEmailItems>> = [];

    for (const account of config.emailAccounts) {
      if (account.isNewsAccount) continue;
      const items = await fetchEmailItems(account, config.emailYears, emailSkipSet);
      allEmailItems.push(...items);
    }

    state.phases.email.total = allEmailItems.length;
    updateProgress(state);

    let emailExtractions: Awaited<ReturnType<typeof extractEmails>> = [];
    if (!dryRun && allEmailItems.length > 0) {
      emailExtractions = await extractEmails(allEmailItems, dbRunId!, config.ollamaModel, (done) => {
        state.phases.email.processed = done;
        updateProgress(state);
      });
    }
    state.phases.email.done = true;
    if (!dryRun) await saveCheckpoint(state);
    updateProgress(state);

    // --- Phase 2: Tasks ---
    const taskItems = await fetchTaskItems();
    state.phases.tasks.total = taskItems.length;
    updateProgress(state);

    // --- Phase 3: Keep ---
    const keepSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("keep");
    const keepNotes = await fetchKeepNotes();
    state.phases.keep.total = keepNotes.filter((n) => !keepSkipSet.has(n.id)).length;
    updateProgress(state);

    let noteExtractions: Awaited<ReturnType<typeof extractNotes>> = [];
    if (!dryRun && keepNotes.length > 0) {
      noteExtractions = await extractNotes(keepNotes, dbRunId!, config.ollamaModel, keepSkipSet, (done) => {
        state.phases.keep.processed = done;
        updateProgress(state);
      });
    }
    state.phases.keep.done = true;
    state.phases.tasks.done = true;
    if (!dryRun) await saveCheckpoint(state);
    updateProgress(state);

    // --- Phase 4: GitHub ---
    let githubRepos: Awaited<ReturnType<typeof fetchGitHubRepos>> = [];
    if (config.githubToken) {
      githubRepos = await fetchGitHubRepos(config.githubToken);
    }
    state.phases.github.total = githubRepos.length;
    state.phases.github.done = true;
    updateProgress(state);

    if (dryRun) {
      stopProgress();
      console.log("\n[dry-run] Inventory complete:");
      console.log(`  Email: ${allEmailItems.length} items`);
      console.log(`  Tasks: ${taskItems.length} items`);
      console.log(`  Keep: ${keepNotes.length} notes (${state.phases.keep.total} new)`);
      console.log(`  GitHub: ${githubRepos.length} repos`);
      return;
    }

    // --- Phase 5: Synthesis ---
    const contactProfiles = batchContacts(emailExtractions);
    const notesByCategory = noteExtractions.reduce((map, n) => {
      const arr = map.get(n.category) ?? [];
      arr.push(n);
      map.set(n.category, arr);
      return map;
    }, new Map<string, typeof noteExtractions>());

    let fullContext: string;

    if (mode === "update") {
      // Load previous context document for patch synthesis
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

      const deltaParts = {
        contacts: emailExtractions.length > 0 ? await synthesizeContacts(contactProfiles) : undefined,
        tasks: await synthesizeTasks(taskItems),
        keep: noteExtractions.length > 0 ? await synthesizeKeep(notesByCategory) : undefined,
        github: githubRepos.length > 0 ? await synthesizeGitHub(githubRepos) : undefined,
      };

      const existingCount = lastRun?.itemsIndexed ?? 0;
      const deltaCount = emailExtractions.length + noteExtractions.length + githubRepos.length;

      fullContext = existingContext
        ? await synthesizePatch(existingContext, deltaParts, { existing: existingCount, delta: deltaCount })
        : await synthesizeFullContext({ contacts: deltaParts.contacts ?? "", tasks: deltaParts.tasks, keep: deltaParts.keep ?? "", github: deltaParts.github ?? "" });
    } else {
      const [contactsSummary, tasksSummary, keepSummary, githubSummary] = await Promise.all([
        emailExtractions.length > 0 ? synthesizeContacts(contactProfiles) : Promise.resolve("No email data"),
        synthesizeTasks(taskItems),
        noteExtractions.length > 0 ? synthesizeKeep(notesByCategory) : Promise.resolve("No Keep data"),
        githubRepos.length > 0 ? synthesizeGitHub(githubRepos) : Promise.resolve("No GitHub data"),
      ]);

      fullContext = await synthesizeFullContext({ contacts: contactsSummary, tasks: tasksSummary, keep: keepSummary, github: githubSummary });

      const { jsonPath, mdPath } = await writeOutputFiles(
        { contacts: contactsSummary, tasks: tasksSummary, keep: keepSummary, github: githubSummary, fullContext },
        config.outputDir,
        today,
      );

      state.phases.synthesis.done = true;
      updateProgress(state);

      // --- Phase 6: DB Seeding ---
      await seedContacts(contactProfiles);
      await seedEntities(emailExtractions, noteExtractions);
      await seedStandingContext(noteExtractions);

      state.phases.dbSeed.done = true;
      updateProgress(state);

      // Finalize run record
      const totalIndexed = emailExtractions.length + noteExtractions.length + githubRepos.length + taskItems.length;
      await db
        .update(contextBuilderRuns)
        .set({ status: "completed", completedAt: new Date().toISOString(), itemsIndexed: totalIndexed, outputPath: jsonPath })
        .where(eq(contextBuilderRuns.id, dbRunId!));

      await clearCheckpoint();

      stopProgress();
      console.log(`\nContext Builder complete!`);
      console.log(`Output: ${mdPath}`);
      console.log(`Items indexed: ${totalIndexed}`);
      return;
    }

    // Update mode output path
    const { jsonPath, mdPath } = await writeOutputFiles(
      { contacts: "", tasks: "", keep: "", github: "", fullContext },
      config.outputDir,
      today,
    );

    state.phases.synthesis.done = true;
    updateProgress(state);

    await seedContacts(contactProfiles);
    await seedEntities(emailExtractions, noteExtractions);
    await seedStandingContext(noteExtractions);

    state.phases.dbSeed.done = true;
    updateProgress(state);

    const totalIndexed = emailExtractions.length + noteExtractions.length + githubRepos.length + taskItems.length;
    await db
      .update(contextBuilderRuns)
      .set({ status: "completed", completedAt: new Date().toISOString(), itemsIndexed: totalIndexed, outputPath: jsonPath })
      .where(eq(contextBuilderRuns.id, dbRunId!));

    await clearCheckpoint();
    stopProgress();
    console.log(`\nContext Builder complete!`);
    console.log(`Output: ${mdPath}`);
    console.log(`Items indexed: ${totalIndexed}`);

  } catch (err) {
    state.phases.synthesis.done = false;
    await saveCheckpoint(state);
    if (dbRunId) {
      await db
        .update(contextBuilderRuns)
        .set({ status: "interrupted" })
        .where(eq(contextBuilderRuns.id, dbRunId));
    }
    stopProgress();
    console.error("\nContext Builder failed:", err);
    process.exit(1);
  }
}

main();
