/**
 * Tunes the question queue's reconcile call without a pipeline run.
 *
 *   bun run scripts/questions-dry-run.ts [--apply]
 *
 * Runs the reconcile for real over the open questions, with no new candidates - one model call,
 * what a quiet morning's Phase 4 costs - and prints what it would do to each: keep, rephrase,
 * merge, or close with the reason. Stores nothing unless `--apply` is given, in which case the
 * plan is written exactly as Phase 4 would write it (useful once after a migration, or to tidy
 * the queue now rather than tomorrow morning).
 *
 * It reads the database (the queue, notes, contacts, standing rules) and the Context Builder
 * document, so on a machine off the LAN it needs the DB tunnel described in docs/operations.md.
 */

import { utcDay } from "../src/util/time";
import { reconcileQueue } from "../src/questions/reconcile";
import { applyPlan } from "../src/questions/apply-plan";
import { listOpen } from "../src/questions/store";

const apply = process.argv.includes("--apply");
const today = utcDay();

const open = new Map((await listOpen()).map((q) => [q.id, q]));
const { plan, tokensIn, tokensOut } = await reconcileQueue([], today);
const text = (id: string) => `"${open.get(id)?.question ?? id}"`;

console.log(`\n${open.size} open question(s), ${tokensIn} tokens in, ${tokensOut} out\n`);
for (const r of plan.rewrites) console.log(`REPHRASE ${text(r.id)}\n  now:    "${r.question}"\n  why:    ${r.reason}\n`);
for (const m of plan.merges) console.log(`MERGE    ${text(m.id)}\n  into:   ${text(m.into)}\n  why:    ${m.reason}\n`);
for (const r of plan.resolves) console.log(`RESOLVE  ${text(r.id)}\n  why:    ${r.reason}\n`);

const changed = new Set([...plan.rewrites, ...plan.merges, ...plan.resolves].map((x) => x.id));
for (const [id] of open) if (!changed.has(id)) console.log(`KEEP     ${text(id)}`);

if (apply) {
  await applyPlan(plan, today);
  console.log("\nApplied.");
} else {
  console.log("\nDry run: nothing stored. Pass --apply to write the plan.");
}

process.exit(0);
