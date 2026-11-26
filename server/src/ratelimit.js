// Per-client rate limit for /api/simulate, so one browser can't keep every Scilab worker busy.
// A sliding window per key, in memory (one server process). Requests carrying the grader token
// (scope.io's server re-simulating a submission) are exempt: scope.io rate-limits its own users.

import { timingSafeEqual } from 'node:crypto';

/** @param {{ perMinute: number, now?: () => number }} opts  perMinute <= 0 disables the limit */
export function createLimiter({ perMinute, now = Date.now }) {
  const hits = new Map();
  const WINDOW = 60_000;
  return {
    /** true if the request may go ahead (and counts it) */
    allow(key) {
      if (!(perMinute > 0)) return true;
      const t = now();
      if (hits.size > 10_000) {
        for (const [k, times] of hits) if (times.every((x) => t - x >= WINDOW)) hits.delete(k);
      }
      const recent = (hits.get(key) || []).filter((x) => t - x < WINDOW);
      if (recent.length >= perMinute) { hits.set(key, recent); return false; }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

/** Does the Authorization header carry the grader token? False when no token is configured. */
export function isGrader(authHeader, token) {
  if (!token || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return false;
  const a = Buffer.from(authHeader.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The client's address: the first X-Forwarded-For hop when behind a trusted proxy (nginx). */
export function clientKey(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}
