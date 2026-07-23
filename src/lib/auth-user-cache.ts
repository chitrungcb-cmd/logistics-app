import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/generated/prisma/enums";

export type AuthUserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  modulePermissions: string[];
  isActive: boolean;
};

type CacheEntry = {
  expiresAt: number;
  value: Promise<AuthUserRecord | null>;
};

const CACHE_TTL_MS = 3_000;
const MAX_CACHE_ENTRIES = 500;

const globalForAuthCache = globalThis as typeof globalThis & {
  authUserCache?: Map<string, CacheEntry>;
};

const authUserCache = globalForAuthCache.authUserCache ?? new Map<string, CacheEntry>();
globalForAuthCache.authUserCache = authUserCache;

function trimExpiredEntries(now: number) {
  if (authUserCache.size < MAX_CACHE_ENTRIES) return;
  for (const [userId, entry] of authUserCache) {
    if (entry.expiresAt <= now) authUserCache.delete(userId);
  }
  while (authUserCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = authUserCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    authUserCache.delete(oldestKey);
  }
}

/**
 * Deduplicates the burst of identical user lookups produced by a page, its layout and its APIs.
 * The short TTL bounds stale authorization on multi-process deployments; local mutations also
 * invalidate immediately through invalidateAuthUser().
 */
export async function getCachedAuthUser(userId: string): Promise<AuthUserRecord | null> {
  const now = Date.now();
  const cached = authUserCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) authUserCache.delete(userId);

  trimExpiredEntries(now);
  const value = prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      role: true,
      modulePermissions: true,
      isActive: true,
    },
  });
  authUserCache.set(userId, { expiresAt: now + CACHE_TTL_MS, value });

  try {
    return await value;
  } catch (error) {
    if (authUserCache.get(userId)?.value === value) authUserCache.delete(userId);
    throw error;
  }
}

export function invalidateAuthUser(userId: string) {
  authUserCache.delete(userId);
}

