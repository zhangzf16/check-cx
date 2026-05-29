import { getSqliteDb } from "@/lib/database/sqlite";
import { SystemNotificationRow } from "@/lib/types/database";

/**
 * 服务端获取所有活跃的系统通知
 */
export async function getActiveSystemNotifications(): Promise<SystemNotificationRow[]> {
  try {
    return getSqliteDb()
      .prepare(
        `
        SELECT id, message, is_active, level, created_at
        FROM system_notifications
        WHERE is_active = 1
        ORDER BY created_at DESC
        `
      )
      .all()
      .map((row) => ({
        ...(row as SystemNotificationRow),
        is_active: Boolean((row as SystemNotificationRow).is_active),
      }));
  } catch (error) {
    console.error("Failed to fetch system notifications:", error);
    return [];
  }
}
