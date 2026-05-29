"use client";

import {
  BellIcon,
  DatabaseIcon,
  FileJsonIcon,
  KeyRoundIcon,
  Layers3Icon,
  LogOutIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  ServerCogIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PROVIDERS = ["openai", "gemini", "anthropic"] as const;
const NOTIFICATION_LEVELS = ["info", "warning", "error"] as const;
const RESOURCES = ["configs", "models", "templates", "groups", "notifications"] as const;

type ProviderType = (typeof PROVIDERS)[number];
type Resource = (typeof RESOURCES)[number];
type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];
type Row = Record<string, unknown> & { id: string };

interface TemplateRow extends Row {
  name: string;
  type: ProviderType;
  request_header: string | null;
  metadata: string | null;
}

interface ModelRow extends Row {
  type: ProviderType;
  model: string;
  template_id: string | null;
  template_name: string | null;
}

interface ConfigRow extends Row {
  name: string;
  type: ProviderType;
  model_id: string;
  model: string;
  endpoint: string;
  api_key_mask: string;
  enabled: boolean;
  is_maintenance: boolean;
  group_name: string | null;
}

interface GroupRow extends Row {
  group_name: string;
  website_url: string | null;
  tags: string | null;
}

interface NotificationRow extends Row {
  message: string;
  is_active: boolean;
  level: NotificationLevel;
  created_at: string;
}

interface AdminData {
  templates: TemplateRow[];
  models: ModelRow[];
  configs: ConfigRow[];
  groups: GroupRow[];
  notifications: NotificationRow[];
}

interface AuthState {
  configured: boolean;
  authenticated: boolean;
}

const EMPTY_DATA: AdminData = {
  templates: [],
  models: [],
  configs: [],
  groups: [],
  notifications: [],
};

const RESOURCE_META: Record<
  Resource,
  {
    label: string;
    description: string;
    icon: typeof ServerCogIcon;
  }
> = {
  configs: {
    label: "检测配置",
    description: "维护实际参与轮询的 Endpoint、密钥、启用状态和维护模式。",
    icon: ServerCogIcon,
  },
  models: {
    label: "模型",
    description: "维护可复用模型定义，并可绑定请求模板。",
    icon: Layers3Icon,
  },
  templates: {
    label: "请求模板",
    description: "维护复用请求头和 metadata，JSON 必须是对象。",
    icon: FileJsonIcon,
  },
  groups: {
    label: "分组",
    description: "维护 Dashboard 分组官网地址和标签。",
    icon: DatabaseIcon,
  },
  notifications: {
    label: "系统通知",
    description: "维护顶部通知横幅内容和展示状态。",
    icon: BellIcon,
  },
};

type FormValues = Record<string, string | boolean>;

function baseValues(resource: Resource): FormValues {
  switch (resource) {
    case "configs":
      return {
        name: "",
        type: "openai",
        model_id: "",
        endpoint: "",
        api_key: "",
        enabled: true,
        is_maintenance: false,
        group_name: "",
      };
    case "models":
      return {
        type: "openai",
        model: "",
        template_id: "",
      };
    case "templates":
      return {
        name: "",
        type: "openai",
        request_header: "",
        metadata: "",
      };
    case "groups":
      return {
        group_name: "",
        website_url: "",
        tags: "",
      };
    case "notifications":
      return {
        message: "",
        is_active: true,
        level: "info",
      };
  }
}

function valuesFromRow(resource: Resource, row: Row): FormValues {
  switch (resource) {
    case "configs": {
      const item = row as ConfigRow;
      return {
        name: item.name,
        type: item.type,
        model_id: item.model_id,
        endpoint: item.endpoint,
        api_key: "",
        enabled: item.enabled,
        is_maintenance: item.is_maintenance,
        group_name: item.group_name ?? "",
      };
    }
    case "models": {
      const item = row as ModelRow;
      return {
        type: item.type,
        model: item.model,
        template_id: item.template_id ?? "",
      };
    }
    case "templates": {
      const item = row as TemplateRow;
      return {
        name: item.name,
        type: item.type,
        request_header: item.request_header ?? "",
        metadata: item.metadata ?? "",
      };
    }
    case "groups": {
      const item = row as GroupRow;
      return {
        group_name: item.group_name,
        website_url: item.website_url ?? "",
        tags: item.tags ?? "",
      };
    }
    case "notifications": {
      const item = row as NotificationRow;
      return {
        message: item.message,
        is_active: item.is_active,
        level: item.level,
      };
    }
  }
}

function getRows(data: AdminData, resource: Resource): Row[] {
  return data[resource] as Row[];
}

function stringifyCell(value: unknown): string {
  if (value == null || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  return String(value);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "请求失败");
  }
  return data;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[0.7rem] font-medium text-muted-foreground">{children}</label>;
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        props.className
      )}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-24 resize-y rounded-md border border-input bg-background px-2 py-2 font-mono text-xs outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        props.className
      )}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        props.className
      )}
    />
  );
}

function SwitchField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-md border border-input px-2 text-xs">
      <input
        checked={checked}
        className="size-3 accent-current"
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

export function AdminConsole() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData>(EMPTY_DATA);
  const [resource, setResource] = useState<Resource>("configs");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(() => baseValues("configs"));
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const filteredModels = useMemo(() => {
    const type = formValues.type;
    return data.models.filter((model) => model.type === type);
  }, [data.models, formValues.type]);

  const filteredTemplates = useMemo(() => {
    const type = formValues.type;
    return data.templates.filter((template) => template.type === type);
  }, [data.templates, formValues.type]);

  async function refreshData() {
    const next = await fetchJson<AdminData>("/api/admin/data", { cache: "no-store" });
    setData(next);
  }

  useEffect(() => {
    fetchJson<AuthState>("/api/admin/auth", { cache: "no-store" })
      .then((nextAuth) => {
        setAuth(nextAuth);
        if (nextAuth.authenticated) {
          return refreshData();
        }
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  function resetForm(nextResource = resource) {
    setEditingId(null);
    setFormValues(baseValues(nextResource));
  }

  function selectResource(nextResource: Resource) {
    setResource(nextResource);
    resetForm(nextResource);
    setMessage(null);
  }

  function editRow(row: Row) {
    setEditingId(row.id);
    setFormValues(valuesFromRow(resource, row));
    setMessage(null);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setMessage(null);
    try {
      await fetchJson("/api/admin/auth", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setAuth({ configured: true, authenticated: true });
      setPassword("");
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function logout() {
    setIsBusy(true);
    try {
      await fetchJson("/api/admin/auth", { method: "DELETE" });
      setAuth((current) => ({ configured: current?.configured ?? true, authenticated: false }));
      setData(EMPTY_DATA);
      resetForm();
    } finally {
      setIsBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setMessage(null);
    try {
      const next = await fetchJson<AdminData>("/api/admin/data", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ resource, id: editingId, values: formValues }),
      });
      setData(next);
      resetForm();
      setMessage("已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function remove(row: Row) {
    if (!window.confirm("确认删除这条记录？")) {
      return;
    }
    setIsBusy(true);
    setMessage(null);
    try {
      const next = await fetchJson<AdminData>("/api/admin/data", {
        method: "DELETE",
        body: JSON.stringify({ resource, id: row.id }),
      });
      setData(next);
      if (editingId === row.id) {
        resetForm();
      }
      setMessage("已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setIsBusy(false);
    }
  }

  if (!auth) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>后台维护</CardTitle>
            <CardDescription>正在检查登录状态。</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!auth.configured) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>后台维护未启用</CardTitle>
            <CardDescription>请先配置环境变量 ADMIN_PASSWORD_HASH。</CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block rounded-md bg-muted p-3 text-xs">
              pnpm admin:hash -- your-password
            </code>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!auth.authenticated) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRoundIcon data-icon="inline-start" />
              后台维护
            </CardTitle>
            <CardDescription>输入维护密码后管理检测配置。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={login}>
              <FieldLabel>维护密码</FieldLabel>
              <TextInput
                autoFocus
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              {message ? <p className="text-xs text-destructive">{message}</p> : null}
              <Button disabled={isBusy} type="submit">
                <KeyRoundIcon data-icon="inline-start" />
                登录
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  const meta = RESOURCE_META[resource];
  const Icon = meta.icon;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-3 py-6 sm:px-6 lg:px-12">
      <header className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-lg font-semibold">检测配置维护</h1>
          <p className="text-xs text-muted-foreground">直接维护 SQLite 中的检测配置、模型、模板、分组和通知。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={isBusy}
            type="button"
            variant="outline"
            onClick={() => {
              setIsBusy(true);
              refreshData()
                .then(() => setMessage("已刷新"))
                .catch((error: Error) => setMessage(error.message))
                .finally(() => setIsBusy(false));
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
          <Button disabled={isBusy} type="button" variant="outline" onClick={logout}>
            <LogOutIcon data-icon="inline-start" />
            退出
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {RESOURCES.map((item) => {
          const ItemIcon = RESOURCE_META[item].icon;
          return (
            <Button
              key={item}
              type="button"
              variant={item === resource ? "default" : "outline"}
              onClick={() => selectResource(item)}
            >
              <ItemIcon data-icon="inline-start" />
              {RESOURCE_META[item].label}
              <Badge variant={item === resource ? "secondary" : "outline"}>{getRows(data, item).length}</Badge>
            </Button>
          );
        })}
      </div>

      {message ? (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon data-icon="inline-start" />
              {meta.label}
            </CardTitle>
            <CardDescription>{meta.description}</CardDescription>
            <CardAction>
              <Button type="button" variant="outline" onClick={() => resetForm()}>
                <PlusIcon data-icon="inline-start" />
                新增
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ResourceTable
              resource={resource}
              rows={getRows(data, resource)}
              onEdit={editRow}
              onRemove={remove}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "编辑记录" : "新增记录"}</CardTitle>
            <CardDescription>
              {resource === "configs" ? "编辑时 API Key 留空会保留原密钥。" : "保存后立即写入数据库。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={save}>
              <ResourceForm
                data={data}
                filteredModels={filteredModels}
                filteredTemplates={filteredTemplates}
                resource={resource}
                values={formValues}
                onChange={(key, value) => setFormValues((current) => ({ ...current, [key]: value }))}
              />
              <div className="flex gap-2 pt-1">
                <Button disabled={isBusy} type="submit">
                  <SaveIcon data-icon="inline-start" />
                  保存
                </Button>
                {editingId ? (
                  <Button disabled={isBusy} type="button" variant="outline" onClick={() => resetForm()}>
                    <XIcon data-icon="inline-start" />
                    取消
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function ResourceForm({
  data,
  filteredModels,
  filteredTemplates,
  resource,
  values,
  onChange,
}: {
  data: AdminData;
  filteredModels: ModelRow[];
  filteredTemplates: TemplateRow[];
  resource: Resource;
  values: FormValues;
  onChange: (key: string, value: string | boolean) => void;
}) {
  const providerSelect = (
    <>
      <FieldLabel>Provider 类型</FieldLabel>
      <SelectInput
        value={String(values.type ?? "openai")}
        onChange={(event) => {
          onChange("type", event.currentTarget.value);
          onChange("model_id", "");
          onChange("template_id", "");
        }}
      >
        {PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {provider}
          </option>
        ))}
      </SelectInput>
    </>
  );

  switch (resource) {
    case "configs":
      return (
        <>
          <FieldLabel>配置名称</FieldLabel>
          <TextInput required value={String(values.name)} onChange={(event) => onChange("name", event.currentTarget.value)} />
          {providerSelect}
          <FieldLabel>模型</FieldLabel>
          <SelectInput
            required
            value={String(values.model_id)}
            onChange={(event) => onChange("model_id", event.currentTarget.value)}
          >
            <option value="">请选择模型</option>
            {filteredModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.model}
              </option>
            ))}
          </SelectInput>
          <FieldLabel>Endpoint</FieldLabel>
          <TextInput
            required
            value={String(values.endpoint)}
            onChange={(event) => onChange("endpoint", event.currentTarget.value)}
          />
          <FieldLabel>API Key</FieldLabel>
          <TextInput
            placeholder="新增必填，编辑留空则不修改"
            type="password"
            value={String(values.api_key)}
            onChange={(event) => onChange("api_key", event.currentTarget.value)}
          />
          <FieldLabel>分组</FieldLabel>
          <SelectInput value={String(values.group_name)} onChange={(event) => onChange("group_name", event.currentTarget.value)}>
            <option value="">未分组</option>
            {data.groups.map((group) => (
              <option key={group.id} value={group.group_name}>
                {group.group_name}
              </option>
            ))}
          </SelectInput>
          <div className="grid gap-2 sm:grid-cols-2">
            <SwitchField checked={Boolean(values.enabled)} label="启用检测" onChange={(checked) => onChange("enabled", checked)} />
            <SwitchField
              checked={Boolean(values.is_maintenance)}
              label="维护模式"
              onChange={(checked) => onChange("is_maintenance", checked)}
            />
          </div>
        </>
      );
    case "models":
      return (
        <>
          {providerSelect}
          <FieldLabel>模型名称</FieldLabel>
          <TextInput required value={String(values.model)} onChange={(event) => onChange("model", event.currentTarget.value)} />
          <FieldLabel>请求模板</FieldLabel>
          <SelectInput value={String(values.template_id)} onChange={(event) => onChange("template_id", event.currentTarget.value)}>
            <option value="">不绑定</option>
            {filteredTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </SelectInput>
        </>
      );
    case "templates":
      return (
        <>
          <FieldLabel>模板名称</FieldLabel>
          <TextInput required value={String(values.name)} onChange={(event) => onChange("name", event.currentTarget.value)} />
          {providerSelect}
          <FieldLabel>请求头 JSON</FieldLabel>
          <TextArea value={String(values.request_header)} onChange={(event) => onChange("request_header", event.currentTarget.value)} />
          <FieldLabel>Metadata JSON</FieldLabel>
          <TextArea value={String(values.metadata)} onChange={(event) => onChange("metadata", event.currentTarget.value)} />
        </>
      );
    case "groups":
      return (
        <>
          <FieldLabel>分组名称</FieldLabel>
          <TextInput
            required
            value={String(values.group_name)}
            onChange={(event) => onChange("group_name", event.currentTarget.value)}
          />
          <FieldLabel>官网地址</FieldLabel>
          <TextInput value={String(values.website_url)} onChange={(event) => onChange("website_url", event.currentTarget.value)} />
          <FieldLabel>标签</FieldLabel>
          <TextInput
            placeholder="英文逗号分隔"
            value={String(values.tags)}
            onChange={(event) => onChange("tags", event.currentTarget.value)}
          />
        </>
      );
    case "notifications":
      return (
        <>
          <FieldLabel>通知内容</FieldLabel>
          <TextArea required value={String(values.message)} onChange={(event) => onChange("message", event.currentTarget.value)} />
          <FieldLabel>通知级别</FieldLabel>
          <SelectInput value={String(values.level)} onChange={(event) => onChange("level", event.currentTarget.value)}>
            {NOTIFICATION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </SelectInput>
          <SwitchField checked={Boolean(values.is_active)} label="展示通知" onChange={(checked) => onChange("is_active", checked)} />
        </>
      );
  }
}

function ResourceTable({
  resource,
  rows,
  onEdit,
  onRemove,
}: {
  resource: Resource;
  rows: Row[];
  onEdit: (row: Row) => void;
  onRemove: (row: Row) => void;
}) {
  if (rows.length === 0) {
    return <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">暂无数据</div>;
  }

  return (
    <Table>
      <TableHeader>
        <Header resource={resource} />
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <Cells resource={resource} row={row} />
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button size="icon-sm" type="button" variant="outline" aria-label="编辑" onClick={() => onEdit(row)}>
                  <PencilIcon />
                </Button>
                <Button size="icon-sm" type="button" variant="destructive" aria-label="删除" onClick={() => onRemove(row)}>
                  <Trash2Icon />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Header({ resource }: { resource: Resource }) {
  const headers: Record<Resource, string[]> = {
    configs: ["名称", "类型", "模型", "Endpoint", "密钥", "启用", "维护", "分组", ""],
    models: ["类型", "模型", "模板", ""],
    templates: ["名称", "类型", "请求头", "Metadata", ""],
    groups: ["分组", "官网", "标签", ""],
    notifications: ["内容", "级别", "展示", "创建时间", ""],
  };
  return (
    <TableRow>
      {headers[resource].map((header) => (
        <TableHead key={header || "actions"} className={header ? "" : "text-right"}>
          {header}
        </TableHead>
      ))}
    </TableRow>
  );
}

function Cells({ resource, row }: { resource: Resource; row: Row }) {
  switch (resource) {
    case "configs": {
      const item = row as ConfigRow;
      return (
        <>
          <TableCell className="font-medium">{item.name}</TableCell>
          <TableCell>
            <Badge variant="outline">{item.type}</Badge>
          </TableCell>
          <TableCell>{item.model}</TableCell>
          <TableCell className="max-w-[320px] truncate">{item.endpoint}</TableCell>
          <TableCell>{item.api_key_mask}</TableCell>
          <TableCell>{item.enabled ? <Badge variant="success">是</Badge> : <Badge variant="secondary">否</Badge>}</TableCell>
          <TableCell>{item.is_maintenance ? <Badge variant="warning">是</Badge> : <Badge variant="secondary">否</Badge>}</TableCell>
          <TableCell>{stringifyCell(item.group_name)}</TableCell>
        </>
      );
    }
    case "models": {
      const item = row as ModelRow;
      return (
        <>
          <TableCell>
            <Badge variant="outline">{item.type}</Badge>
          </TableCell>
          <TableCell className="font-medium">{item.model}</TableCell>
          <TableCell>{stringifyCell(item.template_name)}</TableCell>
        </>
      );
    }
    case "templates": {
      const item = row as TemplateRow;
      return (
        <>
          <TableCell className="font-medium">{item.name}</TableCell>
          <TableCell>
            <Badge variant="outline">{item.type}</Badge>
          </TableCell>
          <TableCell className="max-w-[220px] truncate">{stringifyCell(item.request_header)}</TableCell>
          <TableCell className="max-w-[220px] truncate">{stringifyCell(item.metadata)}</TableCell>
        </>
      );
    }
    case "groups": {
      const item = row as GroupRow;
      return (
        <>
          <TableCell className="font-medium">{item.group_name}</TableCell>
          <TableCell className="max-w-[300px] truncate">{stringifyCell(item.website_url)}</TableCell>
          <TableCell>{stringifyCell(item.tags)}</TableCell>
        </>
      );
    }
    case "notifications": {
      const item = row as NotificationRow;
      return (
        <>
          <TableCell className="max-w-[420px] truncate font-medium">{item.message}</TableCell>
          <TableCell>
            <Badge variant={item.level === "error" ? "danger" : item.level === "warning" ? "warning" : "outline"}>
              {item.level}
            </Badge>
          </TableCell>
          <TableCell>{item.is_active ? <Badge variant="success">是</Badge> : <Badge variant="secondary">否</Badge>}</TableCell>
          <TableCell>{item.created_at}</TableCell>
        </>
      );
    }
  }
}
