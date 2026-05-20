import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.IMAP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.IMAP_USER,
    pass: process.env.IMAP_PASSWORD,
  },
});

const FROM = process.env.IMAP_USER!;
const TO = process.env.ALERT_EMAIL ?? "ileies200@gmail.com";

export async function sendFailureAlert(date: string, step: string, errors: { attempt: number; error: string; ts: string }[]): Promise<void> {
  const errorLines = errors
    .map((e) => `Attempt ${e.attempt} @ ${new Date(e.ts).toLocaleString("de-DE")}: ${e.error}`)
    .join("\n");

  await transporter.sendMail({
    from: FROM,
    to: TO,
    subject: `PIDRA pipeline failed — ${date} (step: ${step})`,
    text: `The daily PIDRA pipeline failed on ${date}.\n\nFailed step: ${step}\n\n${errorLines}\n\nOpen dashboard: http://localhost:5173/${date}`,
  });
}
