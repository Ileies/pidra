import type { Skill } from "../src/skills/loader";
import nodemailer from "nodemailer";
import { MAIL_OPTION_PARAMS, describeOptions, mailFields, parseMailOptions } from "../src/skills/mail-options";

// Only used for outbound mail - never for pipeline failure alerts.
// Sender is always the system IMAP account; recipient must be explicitly allowed.
const ALLOWED_RECIPIENTS = (process.env.ALLOWED_EMAIL_RECIPIENTS ?? "ileies200@gmail.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const skill: Skill = {
  name: "send_email",
  description: "Send an email from the system account. Recipient must be in the ALLOWED_EMAIL_RECIPIENTS allowlist.",
  risk_level: "medium",
  default_enabled: false,
  parameters: {
    to: { type: "string", required: true, description: "Recipient email address" },
    subject: { type: "string", required: true, description: "Email subject" },
    body: { type: "string", required: true, description: "Email body (plain text, or HTML when html is true)" },
    ...MAIL_OPTION_PARAMS,
  },
  execute: async (params) => {
    const to = String(params.to ?? "").trim();
    const subject = String(params.subject ?? "").trim();
    const body = String(params.body ?? "").trim();

    if (!to || !subject || !body) throw new Error("to, subject, and body are required");

    // Every address the mail reaches or redirects replies to has to be on the allowlist, not just `to`.
    const options = parseMailOptions(params);
    for (const address of [to, ...options.cc, ...options.bcc, ...(options.replyTo ? [options.replyTo] : [])]) {
      if (!ALLOWED_RECIPIENTS.includes(address)) {
        throw new Error(`Recipient not allowed: ${address}. Allowed: ${ALLOWED_RECIPIENTS.join(", ")}`);
      }
    }

    if (options.dryRun) return `Dry run: would send to ${to}${describeOptions(options)}: "${subject}". Nothing was sent.`;

    const transporter = nodemailer.createTransport({
      host: process.env.IMAP_HOST,
      port: 587,
      secure: false,
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: process.env.IMAP_USER,
      to,
      subject,
      ...mailFields(options, body),
    });

    return `Email sent to ${to}${describeOptions(options)}: "${subject}"`;
  },
};

export default skill;
