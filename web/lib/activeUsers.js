/**
 * Active-user presence tracking for the HM Finder page.
 *
 * The client sends a heartbeat every ~15s with a per-browser session id
 * and an optional display name; we keep the most recent heartbeat per
 * session in memory and consider it "active" until it goes quiet for
 * HEARTBEAT_TIMEOUT_MS.
 *
 * In-memory only — fine for `next dev` / a single long-running Node
 * server. On Vercel it's best-effort: state only survives across
 * requests handled by the same warm Lambda instance, so the count can
 * undercount when traffic spreads across instances.
 */

const HEARTBEAT_TIMEOUT_MS = 45_000;

const activeUsers = new Map(); // sessionId -> { name, ip, lastSeen }

/**
 * Record a heartbeat for a session.
 * @param {string} sessionId
 * @param {string} [name]
 * @param {string} [ip]
 */
export function registerHeartbeat(sessionId, name, ip) {
  if (!sessionId || typeof sessionId !== "string") return;
  const cleanName = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Guest";
  activeUsers.set(sessionId.slice(0, 100), {
    name: cleanName,
    ip: ip || "unknown",
    lastSeen: Date.now(),
  });
}

/**
 * Get the list of currently active users (heartbeat within the timeout window).
 * @returns {{ id: string, name: string, ip: string, lastSeen: string }[]}
 */
export function getActiveUsers() {
  const now = Date.now();
  for (const [id, user] of activeUsers) {
    if (now - user.lastSeen > HEARTBEAT_TIMEOUT_MS) {
      activeUsers.delete(id);
    }
  }
  return [...activeUsers.entries()]
    .map(([id, user]) => ({
      id,
      name: user.name,
      ip: user.ip,
      lastSeen: new Date(user.lastSeen).toISOString(),
    }))
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
}

/**
 * Best-effort extraction of the requester's IP from a Next.js Route
 * Handler's Web-standard Request.
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
