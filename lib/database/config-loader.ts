/**
 * 数据库配置加载模块
 */

import "server-only";
import {getSqliteDb} from "./sqlite";
import {getPollingIntervalMs} from "../core/polling-config";
import type {ProviderConfig, ProviderType} from "../types";
import {logError} from "../utils";

interface ConfigCache {
  data: ProviderConfig[];
  lastFetchedAt: number;
}

interface ConfigCacheMetrics {
  hits: number;
  misses: number;
}

type JsonRecord = Record<string, unknown>;

interface ConfigRowWithModel {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  api_key: string;
  is_maintenance: number;
  group_name: string | null;
  model: string | null;
  model_type: string | null;
  template_type: string | null;
  request_header: string | null;
  metadata: string | null;
}

const cache: ConfigCache = {
  data: [],
  lastFetchedAt: 0,
};

const metrics: ConfigCacheMetrics = {
  hits: 0,
  misses: 0,
};

export function getConfigCacheMetrics(): ConfigCacheMetrics {
  return { ...metrics };
}

export function resetConfigCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
}

function normalizeJsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function parseJsonRecord(value: string | null): JsonRecord | null {
  if (!value) {
    return null;
  }
  try {
    return normalizeJsonRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * 从数据库加载启用的 Provider 配置
 * @returns Provider 配置列表
 */
export async function loadProviderConfigsFromDB(options?: {
  forceRefresh?: boolean;
}): Promise<ProviderConfig[]> {
  try {
    const now = Date.now();
    const ttl = getPollingIntervalMs();
    if (!options?.forceRefresh && now - cache.lastFetchedAt < ttl) {
      metrics.hits += 1;
      return cache.data;
    }
    metrics.misses += 1;

    const db = getSqliteDb();
    const data = db
      .prepare(
        `
        SELECT
          c.id,
          c.name,
          c.type,
          c.endpoint,
          c.api_key,
          c.is_maintenance,
          c.group_name,
          m.model,
          m.type AS model_type,
          t.type AS template_type,
          t.request_header,
          t.metadata
        FROM check_configs c
        JOIN check_models m ON m.id = c.model_id
        LEFT JOIN check_request_templates t ON t.id = m.template_id
        WHERE c.enabled = 1
        ORDER BY c.id
        `
      )
      .all() as ConfigRowWithModel[];

    if (data.length === 0) {
      console.warn("[check-cx] 数据库中没有找到启用的配置");
      cache.data = [];
      cache.lastFetchedAt = now;
      return [];
    }

    const configs: ProviderConfig[] = data.map(
      (row: ConfigRowWithModel) => {
        const model = row.model_type === row.type ? row.model : "";
        const templateMatches = row.template_type === null || row.template_type === row.type;
        const mergedRequestHeaders = templateMatches
          ? (parseJsonRecord(row.request_header) as Record<string, string> | null)
          : null;
        const mergedMetadata = templateMatches ? parseJsonRecord(row.metadata) : null;

        return {
          id: row.id,
          name: row.name,
          type: row.type as ProviderType,
          endpoint: row.endpoint,
          model: model ?? "",
          apiKey: row.api_key,
          is_maintenance: Boolean(row.is_maintenance),
          requestHeaders: mergedRequestHeaders,
          metadata: mergedMetadata,
          groupName: row.group_name || null,
        };
      }
    );

    cache.data = configs;
    cache.lastFetchedAt = now;
    return configs;
  } catch (error) {
    logError("加载配置时发生异常", error);
    return [];
  }
}
