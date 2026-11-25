export const maxDuration = 60;
import { NextResponse } from "next/server";
import { gmailSmtpConfigured, sendWithGmail } from "../../../lib/gmailSmtp";
import { enqueueMail, nextBusinessDay } from "../../../lib/gmailQueue";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";

// The send window is anchored to the RECIPIENT's local workday — the sender's timezone is
// irrelevant to whether an email lands mid-workday for the person reading it. The JD states
// where the role is, so use that instead of guessing a national default.
const TZ_BY_REGION = [
  [/\b(pacific|pt)\b|california|\bca\b|washington|\bwa\b|oregon|\bor\b|nevada|\bnv\b|seattle|portland|san francisco|san jose|los angeles|san diego|sunnyvale|palo alto|mountain view|cupertino|santa clara|oakland|berkeley|redmond|bellevue|los altos|menlo park/i, "America/Los_Angeles"],
  [/\b(mountain|mt)\b|colorado|\bco\b|utah|\but\b|new mexico|\bnm\b|arizona|\baz\b|denver|boulder|salt lake|phoenix|tucson/i, "America/Denver"],
  [/\b(central|ct)\b|texas|\btx\b|illinois|\bil\b|minnesota|\bmn\b|missouri|\bmo\b|wisconsin|\bwi\b|austin|dallas|houston|chicago|minneapolis|san antonio|nashville|new orleans|kansas city|st\.? louis/i, "America/Chicago"],
  [/\b(eastern|et)\b|new york|\bny\b|massachusetts|\bma\b|virginia|\bva\b|georgia|\bga\b|florida|\bfl\b|pennsylvania|\bpa\b|north carolina|\bnc\b|new jersey|\bnj\b|maryland|\bmd\b|connecticut|\bct\b|boston|atlanta|miami|philadelphia|washington,? d\.?c|brooklyn|nyc|raleigh|durham|charlotte|pittsburgh/i, "America/New_York"],
];

function timeZoneForLocation(location) {
  if (!location) return null;
  const matches = TZ_BY_REGION.filter(([re]) => re.test(location)).map(([, tz]) => tz);
  const distinct = [...new Set(matches)];
  // A dual-coast posting ("New York; San Francisco") has no single correct zone — picking one
  // would put the other coast at 7pm. Returning null hands it to the cross-country fallback
  // window, which is mid-workday everywhere in the US.
  if (distinct.length !== 1) return null;
  return distinct[0];
}

// Forwards to a Google Apps Script Web App (deployed under the user's own Google account) that
// sends via GmailApp — immediately if no `sendAt` (or one in the near past/present) is given,
// or by creating a server-side time-based trigger for a future `sendAt`. Either way the actual
// send happens from Google's servers, not this route, so it works even after this request
// returns and even if the browser closes. No app password needed.

// Voice rule (2026-10-05): a recipient called our old template AI slop. Same stock-phrase list as
// resume/bin/lint_outreach.py SLOP; any hit refuses the send so no path can bypass the rule.
const SLOP = [
  /\bstood out\b/i,
  /\bespecially because\b/i,
  /\brather than just\b/i,
  /\bdirect overlap\b/i,
  /\bproduction scale\b/i,
  /\boverlaps? closely\b/i,
  /\bi think there is\b/i,
  /\bbring (that|the) same\b/i,
  /\bparticularly around\b/i,
  /\bi was looking into\b/i,
  /\bresonat/i,
  /\bpassion/i,
  /\bexcit/i,
  /\bthrilled\b/i,
  /\bleverag/i,
  /\bcutting[- ]edge\b/i,
  /\bfast[- ]paced\b/i,
  /\bintersection of\b/i,
  /\bdeeply\b/i,
  /\bseamless/i,
  /\brobust\b/i,
  /\binnovat/i,
  /\bsynerg/i,
  /\bjourney\b/i,
  /\bunlock/i,
  /\bempower/i,
  /\belevat/i,
  /\bdelv/i,
  /\blandscape\b/i,
  /\bnavigat/i,
  /\bholistic\b/i,
  /\bspearhead/i,
  /\btestament\b/i,
  /\btruly\b/i,
  /\bgame[- ]chang/i,
  /\baligns? (perfectly|closely|well)\b/i,
  /\bit'?s not just\b/i,
  /\bnot only\b.{0,60}\bbut also\b/i,
  /\bthe focus on\b/i,
  /\breal[- ]world\b/i,
  /\bworld[- ]class\b/i,
  /\blove to\b/i,
  /\bkeen to\b/i,
  /\beager to\b/i,
  /\bimpactful\b/i,
  /\bin today'?s\b/i,
  /\bwhat your team is building\b/i,
  /\bthe kind of (production )?problem\b/i,
  /\binteresting (engineering )?problem\b/i,
  /\bspeaks to\b/i,
  /\bcaught my (eye|attention)\b/i,
];

export async function POST(req) {
  try {
    const { to, subject, text, sendAt, company, role, category, followup1, followup2, location } =
      await req.json();
    if (!to || !subject || !text) {
      return NextResponse.json({ error: "Missing to/subject/text" }, { status: 400 });
    }
    // One follow-up only (2026-11-12): the sender posts followup1 in-thread and skips it if they replied.
    if (followup2) {
      return NextResponse.json({ error: "Refused: only one follow-up is allowed; leave followup2 empty" }, { status: 400 });
    }
    if (/\b(following up|just checking in|circling back|touching base|bumping this|top of your inbox)\b/i.test(String(followup1 || ""))) {
      return NextResponse.json({ error: "Refused: stock follow-up phrase; add one new fact instead" }, { status: 400 });
    }
    // Strict rule (2026-10-02): never send an email containing an em dash or en dash.
    const dashed = [subject, text, followup1, followup2].some((v) => /[\u2014\u2013]/.test(String(v || "")));
    if (dashed) {
      return NextResponse.json({ error: "Refused: em dash or en dash in subject, body, or follow-up" }, { status: 400 });
    }
    const slop = [subject, text, followup1, followup2].map(String).join("\n");
    const hit = SLOP.map((re) => slop.match(re)).find(Boolean);
    if (hit) {
      return NextResponse.json({ error: `Refused: stock phrase "${hit[0]}" reads as AI slop; rewrite it plainly` }, { status: 400 });
    }
    // A configured SMTP transport is the primary sender. Google currently hard-blocks the
    // Apps Script deployment, and probing it first can hold every request open until timeout.
    if (APPS_SCRIPT_URL && !gmailSmtpConfigured()) {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, subject, body: text, sendAt: sendAt || undefined,
          company, role, category, followup1, followup2,
          timeZone: timeZoneForLocation(location),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        return NextResponse.json({
          ok: true,
          scheduled: !!data.scheduled,
          queued: !!data.queued,
          duplicate: !!data.duplicate,
          policy: data.policy || null,
          transport: "apps-script",
        });
      }
      // Only fall back for a definite authorization/deployment failure. An
      // ambiguous timeout could mean Apps Script accepted the message, and
      // retrying through SMTP would create a duplicate.
      if (![401, 403].includes(res.status) && !/access denied|authori[sz]/i.test(String(data.error || ""))) {
        throw new Error(data.error || `Apps Script send failed (${res.status})`);
      }
    }

    if (!gmailSmtpConfigured()) {
      throw new Error("Apps Script is unavailable and Gmail SMTP fallback is not configured");
    }
    if (sendAt && new Date(sendAt).getTime() > Date.now() + 60_000) {
      const queued = await enqueueMail({ to, subject, text, sendAt, company, role, category, followup1, stage: 0 });
      return NextResponse.json({ ok: true, scheduled: true, queued: true, duplicate: false, policy: "gmail-draft-queue", transport: "gmail-smtp", queueId: queued.id });
    }
    const smtp = await sendWithGmail({ to, subject, text });
    if (followup1) {
      await enqueueMail({ to, subject, text: followup1, sendAt: nextBusinessDay().toISOString(), stage: 1, initialSentAt: new Date().toISOString(), inReplyTo: smtp.messageId, company, role, category });
    }
    return NextResponse.json({
      ok: true,
      scheduled: false,
      queued: false,
      duplicate: false,
      policy: "gmail-smtp-fallback",
      transport: "gmail-smtp",
      messageId: smtp.messageId,
      followupDeferred: false,
      followupScheduled: !!followup1,
    });
  } catch (err) {
    console.error("[Send Email Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
