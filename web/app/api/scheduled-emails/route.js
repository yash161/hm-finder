export const maxDuration = 60;
import { NextResponse } from "next/server";
import { gmailSmtpConfigured } from "../../../lib/gmailSmtp";
import { cancelQueuedMail, listQueuedMail } from "../../../lib/gmailQueue";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";

export async function GET() {
  try {
    if (gmailSmtpConfigured()) {
      const scheduled = await listQueuedMail();
      return NextResponse.json({
        scheduled,
        health: {
          queued: scheduled.length,
          drainTriggerInstalled: true,
          drainStalled: false,
          sendPausedUntil: null,
          transport: "gmail-smtp",
          followupsAvailable: true,
        },
      });
    }
    if (!APPS_SCRIPT_URL) return NextResponse.json({ scheduled: [] });

    // Apps Script answers a POST with a 302 to googleusercontent, and roughly one request in
    // three comes back as an HTML interstitial rather than JSON. That is transient, so retry
    // before surfacing anything: the panel should never show a scary error for a hiccup, and
    // never show an empty queue for one either.
    // A 401/403 from Google (2026-11-24: "Access Denied") is not transient: the web app needs to be
    // re-authorized or redeployed. Remember it so the error says that instead of "try again".
    let lastHttpStatus = 0;
    const callOnce = (action) =>
      fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).then((r) => {
        lastHttpStatus = r.status;
        return r.json().catch(() => null);
      });

    const call = async (action) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const out = await callOnce(action).catch(() => null);
        if (out) return out;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
      }
      return null;
    };

    // Health is fetched alongside the list because a queue that looks fine while the sender is
    // dead is exactly the failure that went unnoticed: the emails sat there and nothing said why.
    const [data, status] = await Promise.all([call("list"), call("sendStatus").catch(() => null)]);
    if (!data && (lastHttpStatus === 401 || lastHttpStatus === 403)) {
      if (gmailSmtpConfigured()) {
        return NextResponse.json({
          scheduled: [],
          health: {
            queued: 0,
            drainTriggerInstalled: true,
            drainStalled: false,
            sendPausedUntil: null,
            transport: "gmail-smtp",
            followupsAvailable: true,
          },
        });
      }
      throw new Error(
        `Apps Script sender returned ${lastHttpStatus} Access Denied: open the script, run any function to re-authorize, ` +
          "then check Deploy > Manage deployments (Execute as: Me, Who has access: Anyone). Nothing sends until this is fixed."
      );
    }
    if (!data) throw new Error("Scheduler did not return JSON (transient Apps Script redirect) - try again");
    if (data.error) throw new Error(data.error);
    // Apps Script intermittently answers with an HTML redirect page instead of JSON. That used to
    // parse to {} and fall through to `scheduled: []`, so the panel showed "No scheduled emails"
    // while 70 were actually queued. An unusable response must surface as an error, never as an
    // empty list that looks like a real answer.
    if (!Array.isArray(data.scheduled)) throw new Error("Scheduler response missing the queue - try again");

    return NextResponse.json({
      scheduled: data.scheduled,
      health: status && status.status ? status.status : null,
    });
  } catch (err) {
    console.error("[List Scheduled Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const triggerId = searchParams.get("triggerId");
    if (!triggerId) {
      return NextResponse.json({ error: "Missing triggerId" }, { status: 400 });
    }
    if (gmailSmtpConfigured()) {
      await cancelQueuedMail(triggerId);
      return NextResponse.json({ ok: true });
    }
    if (!APPS_SCRIPT_URL) {
      return NextResponse.json({ error: "Apps Script sender not configured" }, { status: 500 });
    }

    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", triggerId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || "Cancel failed");

    return NextResponse.json({ ok: !!data.ok });
  } catch (err) {
    console.error("[Cancel Scheduled Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
