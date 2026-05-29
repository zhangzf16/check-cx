/**
 * 可用性统计查询模块
 */

import "server-only";

import {getSqliteDb} from "./sqlite";
import {getPollingIntervalMs} from "../core/polling-config";
import type {AvailabilityStats} from "../types/database";
import type {AvailabilityStat, AvailabilityStatsMap} from "../types";
import {logError} from "../utils";

interface AvailabilityCache {
  data: AvailabilityStatsMap;
  lastFetchedAt: number;
}

interface AvailabilityCacheMetrics {
  hits: number;
  misses: number;
}

const cache: AvailabilityCache = {
  data: {},
  lastFetchedAt: 0,
};

const metrics: AvailabilityCacheMetrics = {
  hits: 0,
  misses: 0,
};

export function getAvailabilityCacheMetrics(): AvailabilityCacheMetrics {
  return { ...metrics };
}

export function resetAvailabilityCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
}

export function clearAvailabilityStatsCache(): void {
  cache.data = {};
  cache.lastFetchedAt = 0;
}

function normalizeIds(ids?: Iterable<string> | null): string[] | null {
  if (!ids) {
    return null;
  }
  const normalized = Array.from(ids).filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

function filterStats(
  data: AvailabilityStatsMap,
  ids: string[] | null
): AvailabilityStatsMap {
  if (!ids) {
    return data;
  }
  if (ids.length === 0) {
    return {};
  }
  const result: AvailabilityStatsMap = {};
  for (const id of ids) {
    if (data[id]) {
      result[id] = data[id];
    }
  }
  return result;
}

function mapRows(rows: AvailabilityStats[] | null): AvailabilityStatsMap {
  if (!rows || rows.length === 0) {
    return {};
  }

  const mapped: AvailabilityStatsMap = {};
  for (const row of rows) {
    const entry: AvailabilityStat = {
      period: row.period,
      totalChecks: Number(row.total_checks ?? 0),
      operationalCount: Number(row.operational_count ?? 0),
      availabilityPct:
        row.availability_pct === null ? null : Number(row.availability_pct),
    };

    if (!mapped[row.config_id]) {
      mapped[row.config_id] = [];
    }
    mapped[row.config_id].push(entry);
  }

  return mapped;
}

export async function getAvailabilityStats(
  configIds?: Iterable<string> | null
): Promise<AvailabilityStatsMap> {
  const normalizedIds = normalizeIds(configIds);
  if (Array.isArray(normalizedIds) && normalizedIds.length === 0) {
    return {};
  }

  const ttl = getPollingIntervalMs();
  const now = Date.now();
  if (now - cache.lastFetchedAt < ttl && Object.keys(cache.data).length > 0) {
    metrics.hits += 1;
    return filterStats(cache.data, normalizedIds);
  }
  metrics.misses += 1;

  try {
    const data = queryAvailabilityStats(normalizedIds);
    const mapped = mapRows(data);
    cache.data = mapped;
    cache.lastFetchedAt = now;

    return filterStats(mapped, normalizedIds);
  } catch (error) {
    logError("读取可用性统计失败", error);
    return {};
  }
}

function queryAvailabilityStats(ids: string[] | null): AvailabilityStats[] {
  const params: Record<string, string> = {};
  const idFilter = ids
    ? `AND config_id IN (${ids
        .map((_, index) => {
          const key = `id${index}`;
          params[key] = ids[index];
          return `@${key}`;
        })
        .join(", ")})`
    : "";

  return getSqliteDb()
    .prepare(
      `
      WITH periods(period, days, sort_order) AS (
        VALUES ('7d', 7, 1), ('15d', 15, 2), ('30d', 30, 3)
      )
      SELECT
        h.config_id,
        p.period,
        COUNT(*) AS total_checks,
        SUM(CASE WHEN h.status IN ('operational', 'degraded') THEN 1 ELSE 0 END) AS operational_count,
        ROUND(
          100.0 * SUM(CASE WHEN h.status IN ('operational', 'degraded') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
          2
        ) AS availability_pct
      FROM periods p
      JOIN check_history h
        ON julianday(h.checked_at) > julianday('now', '-' || p.days || ' days')
      WHERE 1 = 1
        ${idFilter}
      GROUP BY h.config_id, p.period, p.sort_order
      ORDER BY h.config_id ASC, p.sort_order ASC
      `
    )
    .all(params) as AvailabilityStats[];
}
