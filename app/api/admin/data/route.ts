import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import { isAdminAuthenticated } from "@/lib/admin/auth";
import { invalidateProviderConfigCache } from "@/lib/database/config-loader";
import { invalidateGroupInfoCache } from "@/lib/database/group-info";
import { getSqliteDb } from "@/lib/database/sqlite";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const RESOURCES = ["templates", "models", "configs", "groups", "notifications"] as const;
const PROVIDERS = ["openai", "gemini", "anthropic"] as const;
const NOTIFICATION_LEVELS = ["info", "warning", "error"] as const;

type Resource = (typeof RESOURCES)[number];
type ProviderType = (typeof PROVIDERS)[number];
type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];
type Values = Record<string, unknown>;

interface MutationBody {
  resource?: Resource;
  id?: string;
  values?: Values;
}

interface ConfigRow {
  id: string;
  name: string;
  type: ProviderType;
  model_id: string;
  model: string;
  model_type: ProviderType;
  endpoint: string;
  api_key: string;
  enabled: number;
  is_maintenance: number;
  group_name: string | null;
  created_at: string;
  updated_at: string;
}

function forbidden() {
  return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isResource(value: unknown): value is Resource {
  return typeof value === "string" && RESOURCES.includes(value as Resource);
}

function requiredString(values: Values, key: string, label: string): string {
  const value = typeof values[key] === "string" ? values[key].trim() : "";
  if (!value) {
    throw new Error(`${label}不能为空`);
  }
  return value;
}

function optionalString(values: Values, key: string): string | null {
  const value = typeof values[key] === "string" ? values[key].trim() : "";
  return value || null;
}

function optionalJsonString(values: Values, key: string, label: string): string | null {
  const value = values[key];
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  if (typeof value !== "string") {
    throw new Error(`${label}必须是 JSON 对象`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return JSON.stringify(parsed);
}

function booleanNumber(values: Values, key: string): number {
  return values[key] === true || values[key] === 1 || values[key] === "1" ? 1 : 0;
}

function providerType(values: Values): ProviderType {
  const value = requiredString(values, "type", "Provider 类型");
  if (!PROVIDERS.includes(value as ProviderType)) {
    throw new Error("Provider 类型只能是 openai、gemini、anthropic");
  }
  return value as ProviderType;
}

function notificationLevel(values: Values): NotificationLevel {
  const value = optionalString(values, "level") ?? "info";
  if (!NOTIFICATION_LEVELS.includes(value as NotificationLevel)) {
    throw new Error("通知级别只能是 info、warning、error");
  }
  return value as NotificationLevel;
}

function timestamp(): string {
  return new Date().toISOString();
}

function maskApiKey(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "已保存";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function loadAdminData(db: Database.Database) {
  const templates = db
    .prepare(
      `
      SELECT id, name, type, request_header, metadata, created_at, updated_at
      FROM check_request_templates
      ORDER BY type ASC, name ASC
      `
    )
    .all();

  const models = db
    .prepare(
      `
      SELECT m.id, m.type, m.model, m.template_id, t.name AS template_name, m.created_at, m.updated_at
      FROM check_models m
      LEFT JOIN check_request_templates t ON t.id = m.template_id
      ORDER BY m.type ASC, m.model ASC
      `
    )
    .all();

  const configs = (db
    .prepare(
      `
      SELECT
        c.id, c.name, c.type, c.model_id, m.model, m.type AS model_type,
        c.endpoint, c.api_key, c.enabled, c.is_maintenance, c.group_name,
        c.created_at, c.updated_at
      FROM check_configs c
      JOIN check_models m ON m.id = c.model_id
      ORDER BY c.group_name ASC, c.name ASC
      `
    )
    .all() as ConfigRow[]).map((row) => ({
    ...row,
    api_key: undefined,
    api_key_mask: maskApiKey(row.api_key),
    enabled: Boolean(row.enabled),
    is_maintenance: Boolean(row.is_maintenance),
  }));

  const groups = db
    .prepare(
      `
      SELECT id, group_name, website_url, tags, created_at, updated_at
      FROM group_info
      ORDER BY group_name ASC
      `
    )
    .all();

  const notifications = db
    .prepare(
      `
      SELECT id, message, is_active, level, created_at
      FROM system_notifications
      ORDER BY created_at DESC
      `
    )
    .all()
    .map((row) => ({
      ...(row as { is_active: number }),
      is_active: Boolean((row as { is_active: number }).is_active),
    }));

  return { templates, models, configs, groups, notifications };
}

function validateModelTemplate(db: Database.Database, type: ProviderType, templateId: string | null) {
  if (!templateId) {
    return;
  }
  const template = db
    .prepare("SELECT type FROM check_request_templates WHERE id = ?")
    .get(templateId) as { type: ProviderType } | undefined;
  if (!template) {
    throw new Error("选择的请求模板不存在");
  }
  if (template.type !== type) {
    throw new Error("模型类型必须与请求模板类型一致");
  }
}

function validateConfigModel(db: Database.Database, type: ProviderType, modelId: string) {
  const model = db.prepare("SELECT type FROM check_models WHERE id = ?").get(modelId) as
    | { type: ProviderType }
    | undefined;
  if (!model) {
    throw new Error("选择的模型不存在");
  }
  if (model.type !== type) {
    throw new Error("配置类型必须与模型类型一致");
  }
}

function createRow(db: Database.Database, resource: Resource, values: Values) {
  const now = timestamp();
  const id = randomUUID();

  switch (resource) {
    case "templates": {
      const type = providerType(values);
      db.prepare(
        `
        INSERT INTO check_request_templates (id, name, type, request_header, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        id,
        requiredString(values, "name", "模板名称"),
        type,
        optionalJsonString(values, "request_header", "请求头"),
        optionalJsonString(values, "metadata", "Metadata"),
        now,
        now
      );
      break;
    }
    case "models": {
      const type = providerType(values);
      const templateId = optionalString(values, "template_id");
      validateModelTemplate(db, type, templateId);
      db.prepare(
        `
        INSERT INTO check_models (id, type, model, template_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(id, type, requiredString(values, "model", "模型名称"), templateId, now, now);
      break;
    }
    case "configs": {
      const type = providerType(values);
      const modelId = requiredString(values, "model_id", "模型");
      validateConfigModel(db, type, modelId);
      db.prepare(
        `
        INSERT INTO check_configs (
          id, name, type, model_id, endpoint, api_key, enabled, is_maintenance, group_name, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        id,
        requiredString(values, "name", "配置名称"),
        type,
        modelId,
        requiredString(values, "endpoint", "Endpoint"),
        requiredString(values, "api_key", "API Key"),
        booleanNumber(values, "enabled"),
        booleanNumber(values, "is_maintenance"),
        optionalString(values, "group_name"),
        now,
        now
      );
      break;
    }
    case "groups":
      db.prepare(
        `
        INSERT INTO group_info (id, group_name, website_url, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(
        id,
        requiredString(values, "group_name", "分组名称"),
        optionalString(values, "website_url"),
        optionalString(values, "tags") ?? "",
        now,
        now
      );
      break;
    case "notifications":
      db.prepare(
        `
        INSERT INTO system_notifications (id, message, is_active, level, created_at)
        VALUES (?, ?, ?, ?, ?)
        `
      ).run(
        id,
        requiredString(values, "message", "通知内容"),
        booleanNumber(values, "is_active"),
        notificationLevel(values),
        now
      );
      break;
  }
}

function updateRow(db: Database.Database, resource: Resource, id: string, values: Values) {
  const now = timestamp();

  switch (resource) {
    case "templates": {
      const type = providerType(values);
      db.prepare(
        `
        UPDATE check_request_templates
        SET name = ?, type = ?, request_header = ?, metadata = ?, updated_at = ?
        WHERE id = ?
        `
      ).run(
        requiredString(values, "name", "模板名称"),
        type,
        optionalJsonString(values, "request_header", "请求头"),
        optionalJsonString(values, "metadata", "Metadata"),
        now,
        id
      );
      break;
    }
    case "models": {
      const type = providerType(values);
      const templateId = optionalString(values, "template_id");
      validateModelTemplate(db, type, templateId);
      db.prepare(
        `
        UPDATE check_models
        SET type = ?, model = ?, template_id = ?, updated_at = ?
        WHERE id = ?
        `
      ).run(type, requiredString(values, "model", "模型名称"), templateId, now, id);
      break;
    }
    case "configs": {
      const type = providerType(values);
      const modelId = requiredString(values, "model_id", "模型");
      const apiKey = optionalString(values, "api_key");
      validateConfigModel(db, type, modelId);
      if (apiKey) {
        db.prepare(
          `
          UPDATE check_configs
          SET name = ?, type = ?, model_id = ?, endpoint = ?, api_key = ?, enabled = ?,
              is_maintenance = ?, group_name = ?, updated_at = ?
          WHERE id = ?
          `
        ).run(
          requiredString(values, "name", "配置名称"),
          type,
          modelId,
          requiredString(values, "endpoint", "Endpoint"),
          apiKey,
          booleanNumber(values, "enabled"),
          booleanNumber(values, "is_maintenance"),
          optionalString(values, "group_name"),
          now,
          id
        );
      } else {
        db.prepare(
          `
          UPDATE check_configs
          SET name = ?, type = ?, model_id = ?, endpoint = ?, enabled = ?,
              is_maintenance = ?, group_name = ?, updated_at = ?
          WHERE id = ?
          `
        ).run(
          requiredString(values, "name", "配置名称"),
          type,
          modelId,
          requiredString(values, "endpoint", "Endpoint"),
          booleanNumber(values, "enabled"),
          booleanNumber(values, "is_maintenance"),
          optionalString(values, "group_name"),
          now,
          id
        );
      }
      break;
    }
    case "groups":
      db.prepare(
        `
        UPDATE group_info
        SET group_name = ?, website_url = ?, tags = ?, updated_at = ?
        WHERE id = ?
        `
      ).run(
        requiredString(values, "group_name", "分组名称"),
        optionalString(values, "website_url"),
        optionalString(values, "tags") ?? "",
        now,
        id
      );
      break;
    case "notifications":
      db.prepare(
        `
        UPDATE system_notifications
        SET message = ?, is_active = ?, level = ?
        WHERE id = ?
        `
      ).run(
        requiredString(values, "message", "通知内容"),
        booleanNumber(values, "is_active"),
        notificationLevel(values),
        id
      );
      break;
  }
}

function deleteRow(db: Database.Database, resource: Resource, id: string) {
  const tables: Record<Resource, string> = {
    templates: "check_request_templates",
    models: "check_models",
    configs: "check_configs",
    groups: "group_info",
    notifications: "system_notifications",
  };
  db.prepare(`DELETE FROM ${tables[resource]} WHERE id = ?`).run(id);
}

function invalidateCaches(resource: Resource) {
  if (resource === "configs" || resource === "models" || resource === "templates") {
    invalidateProviderConfigCache();
  }
  if (resource === "groups" || resource === "configs") {
    invalidateGroupInfoCache();
  }
}

async function readBody(request: Request): Promise<MutationBody | null> {
  return (await request.json().catch(() => null)) as MutationBody | null;
}

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return forbidden();
  }

  return NextResponse.json(loadAdminData(getSqliteDb()), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return forbidden();
  }

  const body = await readBody(request);
  if (!isResource(body?.resource) || !body?.values) {
    return badRequest("参数不完整");
  }

  try {
    createRow(getSqliteDb(), body.resource, body.values);
    invalidateCaches(body.resource);
    return NextResponse.json(loadAdminData(getSqliteDb()));
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "新增失败");
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return forbidden();
  }

  const body = await readBody(request);
  if (!isResource(body?.resource) || !body?.id || !body.values) {
    return badRequest("参数不完整");
  }

  try {
    updateRow(getSqliteDb(), body.resource, body.id, body.values);
    invalidateCaches(body.resource);
    return NextResponse.json(loadAdminData(getSqliteDb()));
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "更新失败");
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return forbidden();
  }

  const body = await readBody(request);
  if (!isResource(body?.resource) || !body?.id) {
    return badRequest("参数不完整");
  }

  try {
    deleteRow(getSqliteDb(), body.resource, body.id);
    invalidateCaches(body.resource);
    return NextResponse.json(loadAdminData(getSqliteDb()));
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "删除失败");
  }
}
