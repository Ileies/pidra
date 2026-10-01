import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { NewsletterSettingsError, listFeeds, createFeed, updateFeed, deleteFeed } from "#lib/server/newsletters.js";

const field = (data: FormData, name: string) => String(data.get(name) ?? "");

function settingsError(err: unknown) {
  if (err instanceof NewsletterSettingsError) return fail(400, { error: err.message });
  if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
    return fail(400, { error: "That source already has an RSS feed." });
  }
  throw err;
}

export const load: PageServerLoad = async () => ({ feeds: await listFeeds() });

export const actions: Actions = {
  createFeed: async ({ request }) => {
    const data = await request.formData();
    try {
      const feed = await createFeed(field(data, "sourceName"), field(data, "url"));
      return { message: "Feed added.", feed };
    } catch (err) { return settingsError(err); }
  },
  updateFeed: async ({ request }) => {
    const data = await request.formData();
    try {
      await updateFeed(field(data, "oldName"), field(data, "sourceName"), field(data, "url"));
      return { message: "Feed updated." };
    } catch (err) { return settingsError(err); }
  },
  deleteFeed: async ({ request }) => {
    const data = await request.formData();
    await deleteFeed(field(data, "sourceName"));
    return { message: "Feed removed. It will no longer be polled." };
  },
};
