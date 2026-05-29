import "server-only";

import { cookies } from "next/headers";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_COOKIE_NAME = "check-cx-admin-session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

interface SessionPayload {
  exp: number;
}

function getAdminPasswordHash(): string | null {
  const value = process.env.ADMIN_PASSWORD_HASH?.trim();
  return value || null;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function isMd5Hash(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

export function isAdminPasswordConfigured(): boolean {
  return Boolean(getAdminPasswordHash());
}

export function hashAdminPassword(password: string): string {
  if (!password) {
    throw new Error("密码不能为空");
  }

  return hashMd5Password(password);
}

function hashMd5Password(password: string): string {
  return createHash("md5").update(password).digest("hex");
}

export function verifyAdminPassword(password: string): boolean {
  const passwordHash = getAdminPasswordHash();
  if (!passwordHash || !password) {
    return false;
  }

  if (!isMd5Hash(passwordHash)) {
    return false;
  }

  return safeEqual(hashMd5Password(password), passwordHash.toLowerCase());
}

export function createAdminSessionValue(): string {
  const passwordHash = getAdminPasswordHash();
  if (!passwordHash) {
    throw new Error("ADMIN_PASSWORD_HASH 未配置");
  }

  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, passwordHash)}`;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const passwordHash = getAdminPasswordHash();
  if (!passwordHash) {
    return false;
  }

  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!value) {
    return false;
  }

  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature || !safeEqual(sign(encodedPayload, passwordHash), signature)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

export const adminCookieName = ADMIN_COOKIE_NAME;
