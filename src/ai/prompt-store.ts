import { desc, eq } from "drizzle-orm";
import { db, promptVersions } from "../db";
import { HttpError } from "../util/errors";

/** Stores a new inactive version of `section`; nothing changes until someone approves it. */
export async function createPromptVersion(input: { section: string; promptText: string; changeSummary?: string | null }) {
  const [latest] = await db
    .select({ version: promptVersions.version })
    .from(promptVersions)
    .where(eq(promptVersions.section, input.section))
    .orderBy(desc(promptVersions.version))
    .limit(1);

  const [row] = await db
    .insert(promptVersions)
    .values({
      section: input.section,
      promptText: input.promptText,
      changeSummary: input.changeSummary ?? null,
      version: (latest?.version ?? 0) + 1,
      active: false,
    })
    .returning();
  return row;
}

export async function approvePromptVersion(id: string): Promise<{ section: string; version: number }> {
  const [target] = await db.select().from(promptVersions).where(eq(promptVersions.id, id)).limit(1);
  if (!target) throw new HttpError("Not found", 404);

  // One transaction: a failure between the two writes must not leave the section with no active version.
  await db.transaction(async (tx) => {
    await tx.update(promptVersions).set({ active: false }).where(eq(promptVersions.section, target.section));
    await tx.update(promptVersions).set({ active: true, approvedAt: new Date().toISOString() }).where(eq(promptVersions.id, id));
  });

  return { section: target.section, version: target.version };
}
