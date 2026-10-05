import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./http";
import { actions } from "./routes/actions";
import { audio } from "./routes/audio";
import { chat } from "./routes/chat";
import { context } from "./routes/context";
import { notes } from "./routes/notes";
import { pipeline } from "./routes/pipeline";
import { questions } from "./routes/questions";
import { skills } from "./routes/skills";
import { sms } from "./routes/sms";

// The skills bridge: Hono app (Bun server), entry point of the bridge process. The dashboard calls it
// server-side; the one public-facing route is POST /webhook/sms. Routes live in ./routes/*, errors
// are mapped to HTTP status by `onError` (./http.ts). See docs/security.md and docs/operations.md.
const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.onError(onError);

app.get("/api/health", (c) => c.json({ status: "ok" }));

for (const routes of [skills, audio, sms, pipeline, questions, notes, actions, chat, context]) {
  app.route("/", routes);
}

export default {
  port: Number(process.env.SKILLS_BRIDGE_PORT ?? 4000),
  // Loopback only (Bun would bind 0.0.0.0): the bridge executes skills, so this must not depend on a firewall rule.
  hostname: process.env.SKILLS_BRIDGE_HOST ?? "127.0.0.1",
  // Bun's default 10s idle timeout cut the assistant's SSE stream (flex-tier calls go quiet far longer). 0 disables it.
  idleTimeout: 0,
  fetch: app.fetch,
};
