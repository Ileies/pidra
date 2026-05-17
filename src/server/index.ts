import { Hono } from "hono";
import { cors } from "hono/cors";
import { runPipeline } from "../pipeline/run";

const app = new Hono();

app.use("/api/*", cors({ origin: ["http://localhost:5173", "http://localhost:4173"] }));

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.post("/api/pipeline/run", async (c) => {
  const date = new Date().toISOString().split("T")[0];
  runPipeline(date).catch(console.error);
  return c.json({ status: "started", date });
});

export default {
  port: Number(process.env.SKILLS_BRIDGE_PORT ?? 4000),
  fetch: app.fetch,
};
