import type { Skill } from "../src/skills/loader";
import { loadEmailAccounts, smtpHost } from "../src/config/email-accounts";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { MAIL_OPTION_PARAMS, describeOptions, mailFields, parseMailOptions } from "../src/skills/mail-options";
import { assertAllowedRecipients, findSenderAccount } from "../src/skills/mail-policy";

// Only used for outbound mail - never for pipeline failure alerts.

const skill: Skill = {
  name: "send_email",
  description: "Send an email from the system account or a configured account. System-account recipients must be allowed.",
  risk_level: "high",
  touches: [],
  default_enabled: false,
  parameters: {
    account: { type: "string", required: false, description: "Sender address or alias from configured accounts. Omit for the system account" },
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

    const options = parseMailOptions(params);
    const key = String(params.account ?? "").trim().toLowerCase();
    let fromAddress: string;
    let transportOptions: SMTPTransport.Options;

    if (key) {
      const accounts = await loadEmailAccounts();
      const account = findSenderAccount(accounts, key);
      if (!account) {
        const available = accounts.flatMap((a) => [a.user, ...(a.aliases ?? [])]).join(", ");
        throw new Error(`No account matching "${params.account}". Available: ${available}`);
      }
      fromAddress = key === account.user.toLowerCase() ? account.user : key;
      transportOptions = {
        host: smtpHost(account),
        port: account.smtp_port ?? 587,
        secure: account.smtp_secure ?? false,
        auth: { user: account.user, pass: account.password },
      };
    } else {
      const allowedRecipients = (process.env.ALLOWED_EMAIL_RECIPIENTS ?? "")
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean);
      assertAllowedRecipients(
        [to, ...options.cc, ...options.bcc, ...(options.replyTo ? [options.replyTo] : [])],
        allowedRecipients,
      );
      fromAddress = process.env.IMAP_USER ?? "";
      transportOptions = {
        host: process.env.IMAP_HOST,
        port: 587,
        secure: false,
        auth: { user: fromAddress, pass: process.env.IMAP_PASSWORD },
      };
    }

    if (options.dryRun) return `Dry run: would send from ${fromAddress} to ${to}${describeOptions(options)}: "${subject}". Nothing was sent.`;

    const info = await nodemailer.createTransport(transportOptions).sendMail({
      from: fromAddress,
      to,
      subject,
      ...mailFields(options, body),
    });

    return `Email sent from ${fromAddress} to ${to}${describeOptions(options)} (messageId=${info.messageId})`;
  },
};

export default skill;
