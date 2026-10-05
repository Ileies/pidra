/**
 * Guard: the OpenAI API rules in CLAUDE.md.
 *
 * `src/ai/openai.ts` is the only OpenAI client: it alone may import the package at runtime, build
 * a client or call the Responses, Chat and speech endpoints, which is how `store: false` and the flex
 * tier reach every call. Nothing may use the hosted `web_search` tool (all search goes through Brave),
 * and `openai.ts` itself must not send `temperature` or `max_tokens`, which `gpt-6-luna` rejects.
 * Comments are ignored (line-based, so block-comment bodies must start with `*`).
 *
 * Run by scripts/check.ts (`bun run check`); behavior of the client is covered by tests/openai-rules.test.ts.
 */
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dir, "..");
const CLIENT = "src/ai/openai.ts";
const SCANNED = ["src", "context-builder", "skills", "scripts", "dashboard/src"];

const OUTSIDE_CLIENT: [RegExp, string][] = [
  [/new\s+OpenAI\s*\(/, "constructs an OpenAI client"],
  [/^(?!\s*import\s+type\b).*\bfrom\s+["']openai["']/, "imports the openai package at runtime"],
  [/\.responses\.(create|stream|parse)\s*\(/, "calls the Responses API directly"],
  [/\.chat\.completions\./, "calls Chat Completions directly"],
  [/\.audio\.(speech|transcriptions)\./, "calls the audio API directly"],
];

const EVERYWHERE: [RegExp, string][] = [
  [/type\s*:\s*["']web_search/, "uses OpenAI's hosted web_search tool (use src/search/brave.ts)"],
  [/web_search_preview/, "uses OpenAI's hosted web_search tool (use src/search/brave.ts)"],
];

const IN_CLIENT_FORBIDDEN: [RegExp, string][] = [
  [/\btemperature\b/, "sends temperature (gpt-6-luna rejects it with a 400)"],
  [/\bmax_tokens\b/, "sends max_tokens (use max_output_tokens)"],
  [/\bmax_completion_tokens\b/, "sends max_completion_tokens (the Responses API takes max_output_tokens)"],
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".svelte-kit" || name === "build") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|svelte)$/.test(name)) yield path;
  }
}

const code = (line: string) => line.replace(/\/\/.*$/, "").replace(/^\s*(\/?\*).*$/, "");

const problems: string[] = [];
const report = (file: string, line: number, why: string, text: string) =>
  problems.push(`  ${file}:${line}  ${why}\n      ${text.trim()}`);

for (const dir of SCANNED) {
  for (const path of walk(join(ROOT, dir))) {
    const file = relative(ROOT, path);
    if (file === "scripts/check-openai-rules.ts") continue;
    const lines = (await Bun.file(path).text()).split("\n");
    lines.forEach((line, index) => {
      const stripped = code(line);
      const rules = [...EVERYWHERE, ...(file === CLIENT ? IN_CLIENT_FORBIDDEN : OUTSIDE_CLIENT)];
      for (const [pattern, why] of rules) if (pattern.test(stripped)) report(file, index + 1, why, line);
    });
  }
}

const client = (await Bun.file(join(ROOT, CLIENT)).text()).split("\n").map(code).join("\n");
if (!/store:\s*false/.test(client)) problems.push(`  ${CLIENT}  no \`store: false\` left in the client`);
if (!/service_tier:\s*["']flex["']/.test(client)) problems.push(`  ${CLIENT}  no \`service_tier: "flex"\` left in the client`);

if (problems.length > 0) {
  console.error("OpenAI API rules (CLAUDE.md) broken:\n");
  console.error(problems.join("\n"));
  console.error("\nGo through src/ai/openai.ts (extractJson, synthesize, converse, speak) and search through src/search/brave.ts.");
  process.exit(1);
}

console.log("check-openai-rules: ok, one OpenAI client, store:false and flex set, no hosted web_search");
