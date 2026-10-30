// Deploy probe, bundled to build/server/verify-context.js: prints whether the long-term context the
// briefing synthesises on loads from the machine it runs on. Output is read by scripts/deploy.ts.
import { loadLongTermContext } from "../src/pipeline/long-term-context";

const c = await loadLongTermContext();
console.log(`${c.intelSections.length + c.personalSections.length} chars, ${c.problem ?? "ok"}`);
process.exit(0);
