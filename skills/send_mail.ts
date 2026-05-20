import type { Skill } from "../src/skills/loader";
import { loadEmailAccounts, smtpHost } from "../src/config/email-accounts";
import nodemailer from "nodemailer";

const skill: Skill = {
  name: "send_mail",
  description: "Send an email from one of the configured accounts",
  risk_level: "medium",
  parameters: {
    account: { type: "string", required: true, description: "Sender address — must match a user or alias in email-accounts.json" },
    to: { type: "string", required: true, description: "Recipient email address" },
    subject: { type: "string", required: true, description: "Email subject" },
    body: { type: "string", required: true, description: "Email body (plain text)" },
  },
  execute: async (params) => {
    const accounts = loadEmailAccounts();
    const key = String(params.account ?? "").trim().toLowerCase();
    const account = accounts.find(
      (a) =>
        a.user.toLowerCase() === key ||
        (a.aliases ?? []).some((alias) => alias.toLowerCase() === key),
    );
    if (!account) {
      const available = accounts
        .flatMap((a) => [a.user, ...(a.aliases ?? [])])
        .join(", ");
      throw new Error(`No account matching "${params.account}". Available: ${available}`);
    }
    const fromAddress = key === account.user.toLowerCase() ? account.user : key;

    const to = String(params.to ?? "").trim();
    const subject = String(params.subject ?? "").trim();
    const body = String(params.body ?? "").trim();
    if (!to || !subject || !body) throw new Error("to, subject, and body are required");

    const transport = nodemailer.createTransport({
      host: smtpHost(account),
      port: account.smtp_port ?? 587,
      secure: account.smtp_secure ?? false,
      auth: { user: account.user, pass: account.password },
    });

    const info = await transport.sendMail({
      from: fromAddress,
      to,
      subject,
      text: body,
    });

    return `Email sent from ${fromAddress} to ${to} (messageId=${info.messageId})`;
  },
};

export default skill;
