/** Building the dashboard, starting its production server against nothing, finding Chrome. */
import { $ } from "bun";
import { join } from "node:path";
import { ARTIFACTS, DASHBOARD } from "./helpers.ts";

/** `PIDRA_CHROME`, else google-chrome, google-chrome-stable or chromium on PATH; exits the process when none exists. */
export function chromePath(): string {
  const found = [process.env.PIDRA_CHROME, Bun.which("google-chrome"), Bun.which("google-chrome-stable"), Bun.which("chromium")].find(Boolean);
  if (!found) {
    console.error("blackhole: no Chrome found. Set PIDRA_CHROME to a Chrome or Chromium binary.");
    process.exit(1);
  }
  return found;
}

export async function build(): Promise<void> {
  const result = await $`bun run build`.cwd(DASHBOARD).quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString() || result.stdout.toString());
    process.exit(1);
  }
}

/** Runs `build/index.js` on a random local port with the DB and skills bridge pointed at a closed port; resolves once /api/health answers. Needs `build()` first. */
export async function startServer(): Promise<{ url: string; stop: () => void }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const server = Bun.spawn(["bun", "build/index.js"], {
    cwd: DASHBOARD,
    env: {
      PATH: process.env.PATH ?? "",
      HOST: "127.0.0.1",
      PORT: String(port),
      // A closed port: the fixture stands in for everything the suite reads, and nothing may write.
      DATABASE_URL: "postgres://blackhole@127.0.0.1:1/none",
      SKILLS_BRIDGE_URL: "http://127.0.0.1:1",
      CONTEXT_BUILDER_OUTPUT_DIR: join(ARTIFACTS, "none"),
      // The 2026-09-28 login gate has no session to check against with the DB closed above; this
      // suite drives the offline layer, not the login flow, so `hooks.server.ts` stubs one in.
      PIDRA_BLACKHOLE_TEST: "1",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = new Response(server.stderr).text();
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${url}/api/health`).then((r) => r.ok, () => false)) return { url, stop: () => server.kill() };
    if (server.exitCode !== null) break;
    await Bun.sleep(100);
  }
  if (server.exitCode === null) server.kill();
  await server.exited;
  const detail = (await stderr).trim();
  throw new Error(`the dashboard build did not start (exit ${server.exitCode})${detail ? `:\n${detail}` : ""}`);
}
