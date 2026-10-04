import { Hono } from "hono";
import { cors } from "hono/cors";
import { onError } from "./http";
import { actions } from "./routes/actions";
import { audio } from "./routes/audio";
import { chat } from "./routes/chat";
import { context } from "./routes/context";
import { notes } from "./routes/notes";
import { pipeline } from "./routes/pipeline";
import { prompts } from "./routes/prompts";
import { questions } from "./routes/questions";
import { skills } from "./routes/skills";
import { sms } from "./routes/sms";

const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));
app.onError(onError);

app.get("/api/health", (c) => c.json({ status: "ok" }));

for (const routes of [skills, audio, sms, pipeline, questions, prompts, notes, actions, chat, context]) {
  app.route("/", routes);
}

export default {
  port: Number(process.env.SKILLS_BRIDGE_PORT ?? 4000),
  // Loopback only. Bun would otherwise bind 0.0.0.0, and the bridge executes skills - the
  // firewall already blocks the port, but this is the rule stated in CLAUDE.md and it should
  // not depend on a firewall rule staying correct. The dashboard reaches it server-side.
  hostname: process.env.SKILLS_BRIDGE_HOST ?? "127.0.0.1",
  // Bun closes idle connections after 10 seconds by default, which cut the assistant's event
  // stream in half: a flex-tier model call goes quiet for far longer than that between tool
  // calls. 0 disables the timeout; the stream ends when the turn does.
  idleTimeout: 0,
  fetch: app.fetch,
};
