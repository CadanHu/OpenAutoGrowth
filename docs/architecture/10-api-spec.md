# 10 — API 接口规范

> Version: 1.0 | Date: 2026-04-09  
> Base URL: `http://localhost:9393`  
> Auth: Bearer JWT (header: `Authorization: Bearer <token>`)

---

## 1. 通用约定

### 响应信封

```json
// 成功
{ "success": true, "data": { ... }, "meta": { "request_id": "uuid" } }

// 失败
{ "success": false, "error": { "code": "CAMPAIGN_NOT_FOUND", "message": "..." } }
```

### 状态码

| Code | 含义 |
|------|------|
| 200 | 查询成功 |
| 201 | 资源已创建 |
| 202 | 异步任务已入队 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 409 | 状态机冲突（如 RUNNING 状态不可再 start） |
| 422 | Pydantic 校验失败 |
| 500 | 服务器内部错误 |

---

## 2. Campaign API

### POST /v1/campaigns
创建 Campaign（状态: DRAFT）

**Request**
```json
{
  "name": "X Pro 冷启动 Q2",
  "goal": "新品 X Pro 冷启动推广，Q2 GMV 达 500 万",
  "budget": { "total": 50000, "currency": "CNY", "daily_cap": 5000 },
  "timeline": { "start": "2026-04-10", "end": "2026-04-30" },
  "kpi": { "metric": "ROAS", "target": 3.0 },
  "constraints": { "channels": ["tiktok", "meta", "google"], "region": "CN" }
}
```

**Response 201**
```json
{
  "success": true,
  "data": {
    "campaign_id": "camp_uuid",
    "status": "DRAFT",
    "created_at": "2026-04-09T10:00:00Z"
  }
}
```

---

### GET /v1/campaigns
列出 Campaign（分页 + 状态过滤）

**Query params:** `status`, `limit` (default 20), `offset` (default 0)

**Response 200**
```json
{
  "success": true,
  "data": { "total": 42, "items": [ { "campaign_id": "...", "status": "RUNNING", ... } ] }
}
```

---

### GET /v1/campaigns/{campaign_id}
获取单个 Campaign 详情

**Response 200** — 返回完整 Campaign 对象含关联 Plan/Task 列表

---

### POST /v1/campaigns/{campaign_id}/start
触发 DAG 规划（DRAFT → PLANNING）
- 异步执行：返回 202，通过 WebSocket 推送进度

**Response 202**
```json
{ "success": true, "data": { "job_id": "arq_job_uuid", "status": "PLANNING" } }
```

---

### POST /v1/campaigns/{campaign_id}/pause
暂停（RUNNING → PAUSED）

### POST /v1/campaigns/{campaign_id}/resume
恢复（PAUSED → RUNNING）

### POST /v1/campaigns/{campaign_id}/complete
手动标记完成（任意活跃状态 → COMPLETED）

---

### GET /v1/campaigns/{campaign_id}/plan
获取当前 Campaign 的 DAG Plan（任务列表 + 依赖关系）

**Response 200**
```json
{
  "success": true,
  "data": {
    "plan_id": "plan_uuid",
    "scenario": "NEW_PRODUCT",
    "tasks": [
      { "id": "t1", "agent_type": "STRATEGY", "status": "DONE", "dependencies": [] },
      { "id": "t2", "agent_type": "CONTENT_GEN", "status": "RUNNING", "dependencies": ["t1"] }
    ]
  }
}
```

---

### GET /v1/campaigns/{campaign_id}/events
获取 Campaign 的领域事件历史流

**Response 200** — 返回 `domain_events` 表中该 campaign 的所有事件，按时间排序

---

## 3. Analytics API

### GET /v1/campaigns/{campaign_id}/reports
获取性能报告列表

**Query params:** `from_date`, `to_date`, `granularity` (HOURLY/DAILY/WEEKLY)

### GET /v1/campaigns/{campaign_id}/reports/latest
获取最新报告（含 CTR、ROAS、CVR、CAC 等指标）

### GET /v1/campaigns/{campaign_id}/anomalies
获取已检测到的异常列表

---

## 4. A2A Agent API

> 遵循 A2A Protocol v0.2.2 规范

### GET /v1/agents
列出所有 Agent 的 AgentCard

**Response 200**
```json
{
  "agents": [
    {
      "name": "planner",
      "description": "场景检测 + DAG 生成",
      "version": "1.0",
      "url": "http://localhost:9393/v1/agents/planner",
      "capabilities": { "streaming": true, "pushNotifications": false },
      "skills": [{ "id": "create_plan", "name": "创建执行计划" }]
    }
  ]
}
```

### GET /v1/agents/{agent_name}
获取单个 Agent 的 AgentCard（服务发现端点）

### POST /v1/agents/{agent_name}/tasks/send
向指定 Agent 发送 A2A Task

**Request**
```json
{
  "id": "task_uuid",
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "{ \"goal\": \"...\", \"budget\": { ... } }" }]
  }
}
```

**Response 200** — A2A Task 对象（含状态 + 结果 artifacts）

### GET /v1/agents/{agent_name}/tasks/{task_id}
查询 A2A Task 状态

### POST /v1/agents/{agent_name}/tasks/{task_id}/cancel
取消 A2A Task

---

## 5. WebSocket API

### WS /ws/{campaign_id}
实时订阅 Campaign 事件推送

**连接后服务端推送格式：**
```json
{
  "type": "campaign.status_changed",
  "campaign_id": "camp_uuid",
  "payload": { "old_status": "PLANNING", "new_status": "RUNNING" },
  "timestamp": "2026-04-09T10:05:00Z"
}
```

**事件类型清单：**

| type | 触发时机 |
|------|---------|
| `campaign.created` | Campaign 创建 |
| `campaign.status_changed` | 状态机转换 |
| `campaign.plan_ready` | DAG Plan 生成完成 |
| `task.started` | 单个 Agent Task 开始 |
| `task.completed` | 单个 Agent Task 完成 |
| `task.failed` | 单个 Agent Task 失败 |
| `content.generated` | ContentGen 产出文案 |
| `assets.generated` | Multimodal 产出素材 |
| `strategy.decided` | Strategy 输出投放方案 |
| `ads.deployed` | ChannelExec 投放完成 |
| `metrics.updated` | Analysis 生成报告 |
| `anomaly.detected` | 异常检测触发 |
| `optimization.applied` | Optimizer 执行优化动作 |

**客户端心跳 ping：**
```json
{ "type": "ping" }
```
服务端返回：
```json
{ "type": "pong", "timestamp": "..." }
```

---

## 6. 健康检查

### GET /health
```json
{ "status": "ok", "version": "1.0.0", "db": "ok", "redis": "ok" }
```

### GET /health/agents
```json
{
  "agents": {
    "planner": "ready",
    "content_gen": "ready",
    "channel_exec": "ready"
  }
}
```
