import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { sendWithGmail } from "./gmailSmtp.js";

const DRAFTS = "[Gmail]/Drafts";
const INBOX = "INBOX";
const QUEUE_SUBJECT = "[HM Finder Queue]";

function client() {
  return new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
    logger: false,
  });
}

export function nextBusinessDay(date = new Date()) {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + 1);
  while (out.getUTCDay() === 0 || out.getUTCDay() === 6) out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

function rawDraft(item) {
  const body = Buffer.from(JSON.stringify(item), "utf8").toString("base64");
  return [
    `From: ${process.env.GMAIL_USER}`, `To: ${process.env.GMAIL_USER}`,
    `Subject: ${QUEUE_SUBJECT} ${item.id}`, "X-HM-Finder-Queue: 1",
    "MIME-Version: 1.0", "Content-Type: application/json; charset=utf-8",
    "Content-Transfer-Encoding: base64", "", body, "",
  ].join("\r\n");
}

function parseDraft(source) {
  const text = Buffer.from(source).toString("utf8");
  const split = text.search(/\r?\n\r?\n/);
  if (split < 0 || !/^X-HM-Finder-Queue:\s*1$/im.test(text.slice(0, split))) return null;
  const encoded = text.slice(split).trim().replace(/\s/g, "");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

export async function enqueueMail(input) {
  const item = { ...input, id: input.id || crypto.randomUUID(), queuedAt: input.queuedAt || new Date().toISOString(), sendAt: input.sendAt || new Date().toISOString(), stage: input.stage || 0 };
  const c = client();
  await c.connect();
  try { await c.append(DRAFTS, rawDraft(item), ["\\Draft"]); }
  finally { await c.logout().catch(() => {}); }
  return item;
}

async function queueEntries(c) {
  const lock = await c.getMailboxLock(DRAFTS);
  try {
    const uids = await c.search({ subject: QUEUE_SUBJECT }, { uid: true });
    const entries = [];
    for (const uid of uids) {
      const msg = await c.fetchOne(uid, { source: true }, { uid: true });
      try { const item = parseDraft(msg.source); if (item) entries.push({ uid, item }); } catch { /* unrelated draft */ }
    }
    return entries.sort((a, b) => new Date(a.item.sendAt) - new Date(b.item.sendAt));
  } finally { lock.release(); }
}

export async function listQueuedMail() {
  const c = client();
  await c.connect();
  try {
    return (await queueEntries(c)).map(({ uid, item }) => ({ triggerId: String(uid), to: item.to, subject: item.subject, sendAt: item.sendAt, queued: true, stage: item.stage }));
  } finally { await c.logout().catch(() => {}); }
}

export async function cancelQueuedMail(uid) {
  const c = client();
  await c.connect();
  try {
    const lock = await c.getMailboxLock(DRAFTS);
    try { return await c.messageDelete(Number(uid), { uid: true }); }
    finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
}

async function recipientReplied(c, item) {
  if (!item.initialSentAt) return false;
  const lock = await c.getMailboxLock(INBOX);
  try { return (await c.search({ from: item.to, since: new Date(item.initialSentAt) }, { uid: true })).length > 0; }
  finally { lock.release(); }
}

export async function drainQueue({ limit = 10 } = {}) {
  const c = client();
  await c.connect();
  const result = { sent: 0, skippedReplies: 0, pending: 0, errors: [] };
  try {
    const due = (await queueEntries(c)).filter(({ item }) => new Date(item.sendAt) <= new Date());
    result.pending = due.length;
    for (const { uid, item } of due.slice(0, limit)) {
      try {
        if (item.stage === 1 && (await recipientReplied(c, item))) {
          await c.mailboxOpen(DRAFTS); await c.messageDelete(uid, { uid: true }); result.skippedReplies++; continue;
        }
        const sent = await sendWithGmail({ to: item.to, subject: item.stage === 1 && !/^re:/i.test(item.subject) ? `Re: ${item.subject}` : item.subject, text: item.text, inReplyTo: item.inReplyTo, references: item.inReplyTo });
        await c.mailboxOpen(DRAFTS); await c.messageDelete(uid, { uid: true }); result.sent++;
        if (item.stage === 0 && item.followup1) {
          await enqueueMail({ to: item.to, subject: item.subject, text: item.followup1, sendAt: nextBusinessDay().toISOString(), stage: 1, initialSentAt: new Date().toISOString(), inReplyTo: sent.messageId, company: item.company, role: item.role });
        }
      } catch (error) { result.errors.push({ id: item.id, error: error.message }); }
    }
    return result;
  } finally { await c.logout().catch(() => {}); }
}
