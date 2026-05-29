import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin/auth";
import { clearDashboardDataCache } from "@/lib/core/dashboard-data";
import { clearPingCache } from "@/lib/core/global-state";
import { clearGroupDashboardDataCache } from "@/lib/core/group-data";
import { clearAvailabilityStatsCache } from "@/lib/database/availability";
import { clearHistory } from "@/lib/database/history";

export const revalidate = 0;
export const dynamic = "force-dynamic";

function forbidden() {
  return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
}

export async function DELETE() {
  if (!(await isAdminAuthenticated())) {
    return forbidden();
  }

  const deletedCount = clearHistory();
  clearPingCache();
  clearDashboardDataCache();
  clearGroupDashboardDataCache();
  clearAvailabilityStatsCache();

  return NextResponse.json({
    deletedCount,
  });
}
