import type { SkillParam } from "./loader";

/** Optional parameters for outbound mail. */
export const MAIL_OPTION_PARAMS: Record<string, SkillParam> = {
  cc: { type: "string", required: false, description: "Copy recipients: email addresses separated by commas. Default: none" },
  bcc: { type: "string", required: false, description: "Blind copy recipients: email addresses separated by commas. Default: none" },
  reply_to: { type: "string", required: false, description: "Address replies should go to. Default: the sender" },
  html: { type: "boolean", required: false, description: "Send body as HTML instead of plain text. Default: false" },
  dry_run: { type: "boolean", required: false, description: "Validate and describe the mail without sending it. Default: false" },
};

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function addressList(value: unknown, name: string): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const addresses = text.split(/[,;]/).map((a) => a.trim()).filter(Boolean);
  for (const address of addresses) {
    if (!ADDRESS.test(address)) throw new Error(`${name} contains something that is not an email address: "${address}"`);
  }
  return addresses;
}

export function flag(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

export interface MailOptions {
  cc: string[];
  bcc: string[];
  replyTo: string | undefined;
  html: boolean;
  dryRun: boolean;
}

export function parseMailOptions(params: Record<string, unknown>): MailOptions {
  return {
    cc: addressList(params.cc, "cc"),
    bcc: addressList(params.bcc, "bcc"),
    replyTo: addressList(params.reply_to, "reply_to")[0],
    html: flag(params.html),
    dryRun: flag(params.dry_run),
  };
}

/** The nodemailer fields for the options that are set, so an unset option never appears in the message. */
export function mailFields(options: MailOptions, body: string) {
  return {
    ...(options.html ? { html: body } : { text: body }),
    ...(options.cc.length ? { cc: options.cc } : {}),
    ...(options.bcc.length ? { bcc: options.bcc } : {}),
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
  };
}

export function describeOptions(options: MailOptions): string {
  const parts = [
    options.cc.length ? `cc ${options.cc.join(", ")}` : null,
    options.bcc.length ? `bcc ${options.bcc.length} address(es)` : null,
    options.replyTo ? `reply-to ${options.replyTo}` : null,
    options.html ? "HTML" : null,
  ].filter(Boolean);
  return parts.length ? ` [${parts.join("; ")}]` : "";
}
