import type { Skill } from "../src/skills/loader";
import nodemailer from "nodemailer";

// Only used for outbound mail — never for pipeline failure alerts.
// Sender is always the system IMAP account; recipient must be explicitly allowed.
const ALLOWED_RECIPIENTS = (process.env.ALLOWED_EMAIL_RECIPIENTS ?? "ileies200@gmail.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const skill: Skill = {
  name: "send_email",
  description: "Send an email from the system account. Recipient must be in the ALLOWED_EMAIL_RECIPIENTS allowlist.",
  risk_level: "medium",
  parameters: {
    to: { type: "string", required: true, description: "Recipient email address" },
    subject: { type: "string", required: true, description: "Email subject" },
    body: { type: "string", required: true, description: "Email body (plain text)" },
  },
  execute: async (params) => {
    const to = String(params.to ?? "").trim();
    const subject = String(params.subject ?? "").trim();
    const body = String(params.body ?? "").trim();

    if (!to || !subject || !body) throw new Error("to, subject, and body are required");

    if (!ALLOWED_RECIPIENTS.includes(to)) {
      throw new Error(`Recipient not allowed: ${to}. Allowed: ${ALLOWED_RECIPIENTS.join(", ")}`);
    }

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
      text: body,
    });

    return `Email sent to ${to}: "${subject}"`;
  },
};

export default skill;
