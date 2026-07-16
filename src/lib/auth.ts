import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/generated/prisma/enums";

export const SESSION_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-logistics-session"
  : "logistics-session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_ISSUER = "nq-logistics";
const SESSION_AUDIENCE = "nq-logistics-web";

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes in production.");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 12) {
    return "Mật khẩu cần ít nhất 12 ký tự.";
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Mật khẩu không được vượt quá 72 byte.";
  }
  return null;
}

function credentialVersion(passwordHash: string) {
  return createHash("sha256").update(passwordHash).digest("base64url");
}

export async function createSessionToken(userId: string, passwordHash: string) {
  return new SignJWT({ userId, credentialVersion: credentialVersion(passwordHash) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

async function verifySessionToken(token: string): Promise<{ userId: string; credentialVersion: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.userId === "string" && typeof payload.credentialVersion === "string"
      ? { userId: payload.userId, credentialVersion: payload.credentialVersion }
      : null;
  } catch {
    return null;
  }
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  modulePermissions: string[];
};

/** Reads the session cookie and re-fetches the user fresh from the DB (so role changes take effect immediately). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return null;
  // A locked account is treated as unauthenticated even if its session JWT is still valid, so
  // locking someone (see /api/users) cuts off any live session on their next request.
  if (!user.isActive) return null;
  // Password resets revoke every existing session for that user without a separate session table.
  if (session.credentialVersion !== credentialVersion(user.passwordHash)) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    modulePermissions: user.modulePermissions,
  };
}

export async function setSessionCookie(userId: string, passwordHash: string) {
  const token = await createSessionToken(userId, passwordHash);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
