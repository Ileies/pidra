import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { NewsletterSettingsError, listSenderRules, createSenderRule, updateSenderRule, deleteSenderRule } from "#lib/server/newsletters.js";

const field = (data: FormData, name: string) => String(data.get(name) ?? "");

function settingsError(err: unknown) {
  if (err instanceof NewsletterSettingsError) return fail(400, { error: err.message });
  if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
    return fail(400, { error: "That sender rule already exists." });
  }
  throw err;
}

export const load: PageServerLoad = async () => ({ rules: await listSenderRules() });

export const actions: Actions = {
  createRule: async ({ request }) => {
    const data = await request.formData();
    try {
      await createSenderRule(field(data, "matchKind"), field(data, "pattern"), field(data, "sourceName"));
      return { message: "Sender rule added." };
    } catch (err) { return settingsError(err); }
  },
  updateRule: async ({ request }) => {
    const data = await request.formData();
    try {
      await updateSenderRule(field(data, "id"), field(data, "matchKind"), field(data, "pattern"), field(data, "sourceName"));
      return { message: "Sender rule updated." };
    } catch (err) { return settingsError(err); }
  },
  deleteRule: async ({ request }) => {
    const data = await request.formData();
    await deleteSenderRule(field(data, "id"));
    return { message: "Sender rule removed." };
  },
};
