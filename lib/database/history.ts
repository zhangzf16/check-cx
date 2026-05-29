/**
 * 历史记录管理模块
 */

import "server-only";
import {getSqliteDb} from "./sqlite";
import type {CheckResult, HistorySnapshot} from "../types";
import {logError} from "../utils";

/**
 * 每个 Provider 最多保留的历史记录数
 */
export const MAX_POINTS_PER_PROVIDER = 60;

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 365;

export const HISTORY_RETENTION_DAYS = (() => {
  const raw = Number(process.env.HISTORY_RETENTION_DAYS);
  if (Number.isFinite(raw)) {
    return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, raw));
  }
  return DEFAULT_RETENTION_DAYS;
})();

export interface HistoryQueryOptions {
  allowedIds?: Iterable<string> | null;
  limitPerConfig?: number;
}

interface HistoryRow {
  config_id: string;
  status: string;
  latency_ms: number | null;
  ping_latency_ms: number | null;
  checked_at: string;
  message: string | null;
  name: string;
  type: string;
  model: string;
  endpoint: string | null;
  group_name: string | null;
}

/**
 * SnapshotStore 负责与数据库交互，提供统一的读/写/清理接口
 */
class SnapshotStore {
  async fetch(options?: HistoryQueryOptions): Promise<HistorySnapshot> {
    const normalizedIds = normalizeAllowedIds(options?.allowedIds);
    if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
      return {};
    }

    try {
      const limitPerConfig = options?.limitPerConfig ?? MAX_POINTS_PER_PROVIDER;
      const rows = fetchRows(normalizedIds, limitPerConfig);
      return mapRowsToSnapshot(rows, limitPerConfig);
    } catch (error) {
      logError("获取历史快照失败", error);
      return {};
    }
  }

  async append(results: CheckResult[]): Promise<void> {
    if (results.length === 0) {
      return;
    }

    try {
      const db = getSqliteDb();
      const insert = db.prepare(`
        INSERT INTO check_history (
          config_id,
          status,
          latency_ms,
          ping_latency_ms,
          checked_at,
          message
        )
        VALUES (@config_id, @status, @latency_ms, @ping_latency_ms, @checked_at, @message)
      `);

      const insertMany = db.transaction((items: CheckResult[]) => {
        for (const result of items) {
          insert.run({
            config_id: result.id,
            status: result.status,
            latency_ms: result.latencyMs,
            ping_latency_ms: result.pingLatencyMs,
            checked_at: result.checkedAt,
            message: result.message,
          });
        }
      });

      insertMany(results);
      await this.prune();
    } catch (error) {
      logError("写入历史记录失败", error);
    }
  }

  async prune(retentionDays: number = HISTORY_RETENTION_DAYS): Promise<void> {
    try {
      const effectiveDays = Math.max(
        MIN_RETENTION_DAYS,
        Math.min(MAX_RETENTION_DAYS, retentionDays)
      );
      const cutoff = new Date(
        Date.now() - effectiveDays * 24 * 60 * 60 * 1000
      ).toISOString();
      getSqliteDb()
        .prepare("DELETE FROM check_history WHERE checked_at < ?")
        .run(cutoff);
    } catch (error) {
      logError("清理历史记录失败", error);
    }
  }

  clear(): number {
    try {
      const result = getSqliteDb().prepare("DELETE FROM check_history").run();
      return Number(result.changes ?? 0);
    } catch (error) {
      logError("清空历史记录失败", error);
      throw error;
    }
  }
}

export const historySnapshotStore = new SnapshotStore();

/**
 * 兼容旧接口：读取全部历史快照
 */
export async function loadHistory(
  options?: HistoryQueryOptions
): Promise<HistorySnapshot> {
  return historySnapshotStore.fetch(options);
}

/**
 * 兼容旧接口：写入并返回最新快照
 */
export async function appendHistory(
  results: CheckResult[]
): Promise<HistorySnapshot> {
  await historySnapshotStore.append(results);
  return historySnapshotStore.fetch();
}

export function clearHistory(): number {
  return historySnapshotStore.clear();
}

function normalizeAllowedIds(
  ids?: Iterable<string> | null
): string[] | null {
  if (!ids) {
    return null;
  }
  const array = Array.from(ids).filter(Boolean);
  return array.length > 0 ? array : [];
}

function fetchRows(
  allowedIds: string[] | null,
  limitPerConfig: number
): HistoryRow[] {
  const db = getSqliteDb();
  const params: Record<string, string | number> = { limitPerConfig };
  const idFilter = allowedIds
    ? `WHERE h.config_id IN (${allowedIds
        .map((_, index) => {
          const key = `id${index}`;
          params[key] = allowedIds[index];
          return `@${key}`;
        })
        .join(", ")})`
    : "";

  return db
    .prepare(
      `
      WITH ranked AS (
        SELECT
          h.config_id,
          h.status,
          h.latency_ms,
          h.ping_latency_ms,
          h.checked_at,
          h.message,
          row_number() OVER (
            PARTITION BY h.config_id
            ORDER BY h.checked_at DESC, h.id DESC
          ) AS rn
        FROM check_history h
        ${idFilter}
      )
      SELECT
        r.config_id,
        r.status,
        r.latency_ms,
        r.ping_latency_ms,
        r.checked_at,
        r.message,
        c.name,
        c.type,
        m.model,
        c.endpoint,
        c.group_name
      FROM ranked r
      JOIN check_configs c ON c.id = r.config_id
      JOIN check_models m ON m.id = c.model_id
      WHERE r.rn <= @limitPerConfig
      ORDER BY c.name ASC, r.checked_at DESC
      `
    )
    .all(params) as HistoryRow[];
}

function mapRowsToSnapshot(
  rows: HistoryRow[] | null,
  limitPerConfig: number = MAX_POINTS_PER_PROVIDER
): HistorySnapshot {
  if (!rows || rows.length === 0) {
    return {};
  }

  const history: HistorySnapshot = {};
  for (const row of rows) {
    const result: CheckResult = {
      id: row.config_id,
      name: row.name,
      type: row.type as CheckResult["type"],
      endpoint: row.endpoint ?? "",
      model: row.model,
      status: row.status as CheckResult["status"],
      latencyMs: row.latency_ms,
      pingLatencyMs: row.ping_latency_ms,
      checkedAt: row.checked_at,
      message: row.message ?? "",
      groupName: row.group_name,
    };

    if (!history[result.id]) {
      history[result.id] = [];
    }
    history[result.id].push(result);
  }

  for (const key of Object.keys(history)) {
    history[key] = history[key]
      .sort(
        (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime()
      )
      .slice(0, limitPerConfig);
  }

  return history;
}
