# Check CX 运维手册

本文面向 SQLite 单机部署，描述运行环境、数据库文件与日常维护要点。

## 1. 运行环境

- Node.js 18 及以上（建议 20 LTS）
- pnpm 10 或 npm
- 本地可写磁盘，用于保存 SQLite 数据库文件

## 2. 环境变量

### 必需

无。应用启动时会自动创建 SQLite 数据库和表结构。

### 可选

- `SQLITE_DB_PATH`：SQLite 数据库文件路径，默认 `data/check-cx.sqlite`
- `CHECK_NODE_ID`：节点标识（多节点部署必须唯一）
- `CHECK_POLL_INTERVAL_SECONDS`：检测间隔（15-600 秒）
- `CHECK_CONCURRENCY`：并发数（1-20）
- `OFFICIAL_STATUS_CHECK_INTERVAL_SECONDS`：官方状态轮询间隔（60-3600 秒）
- `HISTORY_RETENTION_DAYS`：历史保留天数（7-365）

## 3. 数据库初始化

应用启动时自动创建以下表：

- `check_request_templates`
- `check_models`
- `check_configs`
- `check_history`
- `group_info`
- `system_notifications`
- `check_poller_leases`

项目不再依赖外部迁移流程。空库启动后不会自动创建检测配置，需要手动写入 `check_models` 和 `check_configs`。

## 4. 运维操作

### 4.1 添加检测配置

```sql
INSERT OR IGNORE INTO check_models (id, type, model)
VALUES ('model-openai-gpt-4o-mini', 'openai', 'gpt-4o-mini');

INSERT INTO check_configs (
  id,
  name,
  type,
  model_id,
  endpoint,
  api_key,
  enabled
)
VALUES (
  'config-openai-gpt-4o-mini',
  'OpenAI GPT-4o mini',
  'openai',
  'model-openai-gpt-4o-mini',
  'https://api.openai.com/v1/chat/completions',
  'sk-xxx',
  1
);
```

### 4.2 维护模式与禁用

```sql
UPDATE check_configs
SET is_maintenance = 1
WHERE id = 'config-openai-gpt-4o-mini';

UPDATE check_configs
SET enabled = 0
WHERE id = 'config-openai-gpt-4o-mini';
```

### 4.3 分组信息

```sql
INSERT INTO group_info (id, group_name, website_url, tags)
VALUES ('group-main', '主力服务商', 'https://example.com', 'core,prod');
```

### 4.4 系统通知

```sql
INSERT INTO system_notifications (id, message, level, is_active)
VALUES ('notice-1', '**注意**：部分服务延迟升高', 'warning', 1);
```

### 4.5 历史保留

每次写入历史后会自动按 `HISTORY_RETENTION_DAYS` 清理旧记录。

## 5. 部署模式

### 5.1 单节点

默认推荐模式。该节点执行轮询并写入 SQLite。

### 5.2 多节点

SQLite 更适合单节点部署。多节点共享同一个 SQLite 文件需要底层存储提供可靠文件锁；否则建议改用 PostgreSQL。

## 6. 常见问题

### 6.1 页面没有任何卡片

- 确认 `check_configs` 至少一条 `enabled = 1`。
- 确认对应 `model_id` 已正确关联到 `check_models`。
- 检查 `SQLITE_DB_PATH` 指向的数据库文件是否是当前运行实例使用的文件。

### 6.2 时间线一直为空

- 查看轮询器日志是否运行。
- 检查 `check_history` 是否有新增记录。
- 确认 `CHECK_POLL_INTERVAL_SECONDS` 未设置过大。

### 6.3 官方状态显示 unknown

- 当前仅 OpenAI/Anthropic 实现官方状态。
- 检查外网访问是否被阻断或 DNS 被限制。
