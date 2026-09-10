/**
 * Presence endpoint — tracks who's currently viewing the HM Finder page.
 *
 * POST records a heartbeat (session id + optional display name); GET
 * returns everyone seen recently (name, IP, last seen).
 *
 * POST /api/active-users  Body: { sessionId: string, name?: string }
 * GET  /api/active-users  -> { count, users: [{ id, name, ip, lastSeen }] }
 */

import { NextResponse } from "next/server";
import { registerHeartbeat, getActiveUsers, getClientIp } from "@/lib/activeUsers";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  registerHeartbeat(body.sessionId, body.name, getClientIp(request));
  return NextResponse.json({ ok: true });
}

export async function GET(request) {
  const users = getActiveUsers();
  return NextResponse.json({ count: users.length, users });
}
