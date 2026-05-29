import { NextResponse } from "next/server";

import {
  adminCookieName,
  adminSessionCookieOptions,
  createAdminSessionValue,
  isAdminAuthenticated,
  isAdminPasswordConfigured,
  verifyAdminPassword,
} from "@/lib/admin/auth";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    configured: isAdminPasswordConfigured(),
    authenticated: await isAdminAuthenticated(),
  });
}

export async function POST(request: Request) {
  if (!isAdminPasswordConfigured()) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD_HASH 未配置，后台维护入口已关闭" },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  if (!verifyAdminPassword(body?.password ?? "")) {
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminCookieName, createAdminSessionValue(), adminSessionCookieOptions);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminCookieName, "", {
    ...adminSessionCookieOptions,
    maxAge: 0,
  });
  return response;
}
