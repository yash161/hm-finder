import nodemailer from "nodemailer";

export function gmailSmtpConfigured(env = process.env) {
  return Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
}

export function gmailTransport(env = process.env) {
  if (!gmailSmtpConfigured(env)) {
    throw new Error("Gmail SMTP fallback is not configured");
  }
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, ""),
    },
  });
}

export async function sendWithGmail({ to, subject, text, inReplyTo, references }) {
  const from = process.env.GMAIL_USER;
  const info = await gmailTransport().sendMail({
    from, to, subject, text,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
  });
  return { messageId: info.messageId, accepted: info.accepted || [] };
}
