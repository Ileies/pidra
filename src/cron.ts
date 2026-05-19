import cron from "node-cron";
import { runPipeline } from "./pipeline/run";
import { runWeeklySourceScoring } from "./pipeline/weekly-source-scoring";

// PIPELINE_RUN_TIME=HH:MM overrides the default 06:30.
const [hour, minute] = (process.env.PIPELINE_RUN_TIME ?? "06:30").split(":").map(Number);
const cronExpr = `${minute} ${hour} * * *`;

async function runScheduled() {
  const date = new Date().toISOString().split("T")[0];
  console.log(`[cron] Starting pipeline for ${date}`);
  try {
    await runPipeline(date);
    console.log(`[cron] Pipeline completed for ${date}`);
  } catch (err) {
    console.error(`[cron] Pipeline failed for ${date}:`, err);
  }
}

cron.schedule(cronExpr, runScheduled, {
  timezone: "Europe/Berlin",
  noOverlap: true,
});

// Weekly source quality scoring: every Sunday at 23:00
cron.schedule("0 23 * * 0", async () => {
  console.log("[cron] Running weekly source quality scoring");
  try {
    await runWeeklySourceScoring();
    console.log("[cron] Weekly source quality scoring complete");
  } catch (err) {
    console.error("[cron] Weekly source quality scoring failed:", err);
  }
}, { timezone: "Europe/Berlin" });

console.log(`[cron] Scheduled daily pipeline at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Europe/Berlin`);
console.log("[cron] Scheduled weekly source quality scoring at 23:00 Sunday Europe/Berlin");

// Run immediately if --now flag is passed (useful for testing)
if (process.argv.includes("--now")) {
  runScheduled().catch(console.error);
}

// Run weekly scoring immediately if --score flag is passed
if (process.argv.includes("--score")) {
  runWeeklySourceScoring().catch(console.error);
}
