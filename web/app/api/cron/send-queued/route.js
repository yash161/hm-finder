import { NextResponse } from "next/server";
import { drainQueue } from "../../../../lib/gmailQueue";

export const maxDuration = 60;

export async function GET(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await drainQueue({ limit: 10 }));
}
