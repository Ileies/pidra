import { Hono } from "hono";
import { approvePromptVersion, createPromptVersion, deletePromptVersion } from "../../ai/prompt-store";
import { bodyOf, uuidParam } from "../http";

export const prompts = new Hono();

prompts.post("/api/prompts", async (c) => {
  const { section, promptText, changeSummary } = await bodyOf<{ section: string; promptText: string; changeSummary: string }>(c);
  if (!section || !promptText) return c.json({ error: "section and promptText required" }, 400);
  return c.json(await createPromptVersion({ section, promptText, changeSummary }), 201);
});

prompts.post("/api/prompts/:id/approve", uuidParam(), async (c) =>
  c.json({ ok: true, ...(await approvePromptVersion(c.req.param("id"))) }));

prompts.delete("/api/prompts/:id", uuidParam(), async (c) => {
  await deletePromptVersion(c.req.param("id"));
  return c.json({ ok: true });
});
