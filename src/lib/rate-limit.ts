// In-memory login throttle (audit #3, brute-force protection). Keyed by normalized email so an
// attacker can't hammer one account. This is per-process state: on a single instance (VPS) it's
// solid; on horizontally-scaled serverless each instance keeps its own counter, so it's a
// best-effort slowdown there rather than a hard global lock — good enough to defeat naive brute
// force without needing a shared store / schema change. A DB- or Redis-backed limiter can replace
// this later without touching the login route (same three functions).

const MAX_ACCOUNT_FAILURES = 5;
const MAX_ADDRESS_FAILURES = 20;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000; // lock duration once tripped

type Entry = { failures: number; firstFailureAt: number; lockedUntil: number };

const accountAttempts = new Map<string, Entry>();
const addressAttempts = new Map<string, Entry>();

function keyFor(email: string) {
  return email.toLowerCase().trim();
}

function retryAfter(entries: Map<string, Entry>, key: string): number {
  const entry = entries.get(key);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) return Math.ceil((entry.lockedUntil - now) / 1000);
  if (now - entry.firstFailureAt > WINDOW_MS) entries.delete(key);
  return 0;
}

function recordFailure(entries: Map<string, Entry>, key: string, maxFailures: number) {
  const now = Date.now();
  const entry = entries.get(key);

  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    entries.set(key, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
    return;
  }

  entry.failures += 1;
  if (entry.failures >= maxFailures) {
    entry.lockedUntil = now + LOCK_MS;
    entry.failures = 0;
    entry.firstFailureAt = now;
  }
}

/** Returns how many seconds this account/address must wait, or 0 if it may try now. */
export function loginRetryAfter(email: string, address: string): number {
  return Math.max(
    retryAfter(accountAttempts, keyFor(email)),
    retryAfter(addressAttempts, address)
  );
}

/** Rate-limit both one targeted account and one address cycling through many account names. */
export function recordLoginFailure(email: string, address: string): void {
  recordFailure(accountAttempts, keyFor(email), MAX_ACCOUNT_FAILURES);
  recordFailure(addressAttempts, address, MAX_ADDRESS_FAILURES);
}

/** Clear the counter after a successful login. */
export function recordLoginSuccess(email: string, address: string): void {
  accountAttempts.delete(keyFor(email));
  addressAttempts.delete(address);
}
