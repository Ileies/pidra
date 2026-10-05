import type { Actions, PageServerLoad } from "./$types";
import { readForm } from "#lib/server/form.js";
import { fail } from "@sveltejs/kit";
import {
  listEmailAccounts,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  EmailAccountError,
  type EmailAccountInput,
} from "#lib/server/emailAccounts.js";

/**
 * `/settings/email-accounts`: live credential management (actions `create`/`update`/`delete`).
 * Online-only (`ONLINE_ONLY`) since an offline mirror must never hold a copy of credentials.
 */

function accountError(err: unknown) {
  if (err instanceof EmailAccountError) return fail(400, { error: err.message });
  throw err;
}

function readInput(data: FormData): EmailAccountInput {
  return {
    label: String(data.get("label") ?? ""),
    host: String(data.get("host") ?? ""),
    user: String(data.get("user") ?? ""),
    password: String(data.get("password") ?? ""),
    folder: String(data.get("folder") ?? ""),
    isNewsAccount: data.get("isNewsAccount") === "on",
    customInstructions: String(data.get("customInstructions") ?? ""),
    aliases: String(data.get("aliases") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    ignore: String(data.get("ignore") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    smtpHost: String(data.get("smtpHost") ?? ""),
    smtpPort: data.get("smtpPort") ? Number(data.get("smtpPort")) : null,
    smtpSecure: data.get("smtpSecure") === "on",
  };
}

export const load: PageServerLoad = async () => {
  return { accounts: await listEmailAccounts() };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await readForm(request);
    try {
      await createEmailAccount(readInput(form.data));
      return { ok: true, message: "Account added." };
    } catch (err) {
      return accountError(err);
    }
  },

  update: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    if (!id) return fail(400, { error: "Missing account id" });

    try {
      await updateEmailAccount(id, readInput(form.data));
      return { ok: true, message: "Account updated." };
    } catch (err) {
      return accountError(err);
    }
  },

  delete: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    if (!id) return fail(400, { error: "Missing account id" });

    await deleteEmailAccount(id);
    return { ok: true, message: "Account deleted." };
  },
};
