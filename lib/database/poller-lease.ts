/**
 * 轮询主节点租约管理
 */

import "server-only";

import {getSqliteDb} from "./sqlite";
import {logError} from "../utils";

const LEASE_KEY = "poller";
const INITIAL_LEASE_EXPIRES_AT = new Date(0).toISOString();

export async function ensurePollerLeaseRow(): Promise<void> {
  try {
    getSqliteDb()
      .prepare(
        `
        INSERT OR IGNORE INTO check_poller_leases (
          lease_key,
          leader_id,
          lease_expires_at
        )
        VALUES (?, NULL, ?)
        `
      )
      .run(LEASE_KEY, INITIAL_LEASE_EXPIRES_AT);
  } catch (error) {
    logError("初始化轮询租约失败", error);
  }
}

export async function tryAcquirePollerLease(
  nodeId: string,
  now: Date,
  expiresAt: Date
): Promise<boolean> {
  try {
    const nowIso = now.toISOString();
    const result = getSqliteDb()
      .prepare(
        `
        UPDATE check_poller_leases
        SET leader_id = ?,
            lease_expires_at = ?,
            updated_at = ?
        WHERE lease_key = ?
          AND lease_expires_at < ?
        `
      )
      .run(nodeId, expiresAt.toISOString(), nowIso, LEASE_KEY, nowIso);

    return result.changes > 0;
  } catch (error) {
    logError("获取轮询租约失败", error);
    return false;
  }
}

export async function tryRenewPollerLease(
  nodeId: string,
  now: Date,
  expiresAt: Date
): Promise<boolean> {
  try {
    const nowIso = now.toISOString();
    const result = getSqliteDb()
      .prepare(
        `
        UPDATE check_poller_leases
        SET lease_expires_at = ?,
            updated_at = ?
        WHERE lease_key = ?
          AND leader_id = ?
          AND lease_expires_at > ?
        `
      )
      .run(expiresAt.toISOString(), nowIso, LEASE_KEY, nodeId, nowIso);

    return result.changes > 0;
  } catch (error) {
    logError("续租轮询租约失败", error);
    return false;
  }
}
