# 12 — A2A & MCP 协议层设计

> Version: 1.0 | Date: 2026-04-09

## 1. 协议分工

```
┌──────────────────────────────────────────────────┐
│                OpenAutoGrowth                    │
│                                                  │
│  Agent ◄──── A2A ────► Agent (跨服务/跨框架)     │
│    │                                             │
│    └──── MCP ────► Tool (DB / API / Claude)      │
└──────────────────────────────────────────────────┘
```

| 协议 | 解决的问题 | 传输层 |
|------|-----------|--------|
| **A2A** | Agent ↔ Agent 发现、任务委派、状态同步 | HTTP/S + SSE + JSON-RPC 2.0 |
| **MCP** | Agent ↔ Tool 工具调用（Claude function calling） | stdio / HTTP |

---

## 2. A2A AgentCard 规范

每个 Agent 在 `GET /v1/agents/{name}` 暴露 AgentCard：

```json
{
  "name": "content_gen",
  "description": "A/B 文案生成 Agent，调用 Claude 生成多变体营销文案",
  "version": "1.0.0",
  "url": "http://localhost:9393/v1/agents/content_gen",
  "provider": { "organization": "OpenAutoGrowth" },
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "authentication": {
    "schemes": ["bearer"]
  },
  "skills": [
    {
      "id": "generate_copies",
      "name": "生成文案变体",
      "description": "根据产品信息和目标受众生成 N 个 A/B 测试文案",
      "inputModes": ["text"],
      "outputModes": ["text"]
    }
  ]
}
```

### 7 个 Agent 的 AgentCard 清单

| Agent | skills |
|-------|--------|
| `planner` | `create_plan` |
| `strategy` | `score_channels`, `allocate_budget` |
| `content_gen` | `generate_copies` |
| `multimodal` | `generate_images`, `generate_videos` |
| `channel_exec` | `deploy_ads`, `pause_ads` |
| `analysis` | `pull_metrics`, `detect_anomalies` |
| `optimizer` | `evaluate_rules`, `apply_actions` |

---

## 3. A2A Task 生命周期

```
submitted → working → [ input-required ] → completed
                    ↘ failed
                    ↘ canceled
```

### Task 对象

```json
{
  "id": "task_uuid",
  "status": {
    "state": "working",
    "timestamp": "2026-04-09T10:00:00Z"
  },
  "message": {
    "role": "user",
    "parts": [
      { "type": "text", "text": "{ \"goal\": \"新品冷启动\", \"budget\": {...} }" }
    ]
  },
  "artifacts": [
    {
      "name": "plan",
      "parts": [{ "type": "text", "text": "{ \"tasks\": [...] }" }]
    }
  ],
  "metadata": { "campaign_id": "camp_uuid" }
}
```

---

## 4. A2A 端点实现骨架

```python
# app/protocols/a2a/server.py

from fastapi import APIRouter
from .models import AgentCard, Task, SendTaskRequest

router = APIRouter(prefix="/v1/agents")

@router.get("/{agent_name}", response_model=AgentCard)
async def get_agent_card(agent_name: str) -> AgentCard:
    """A2A 服务发现端点 — 返回 AgentCard"""
    ...

@router.post("/{agent_name}/tasks/send", response_model=Task)
async def send_task(agent_name: str, request: SendTaskRequest) -> Task:
    """
    接收 A2A Task，转换为 LangGraph 调用
    1. 解析 message.parts[0].text 为 Agent 输入
    2. 提交 ARQ 任务（异步执行）
    3. 返回 Task(state=submitted)
    """
    ...

@router.get("/{agent_name}/tasks/{task_id}", response_model=Task)
async def get_task(agent_name: str, task_id: str) -> Task:
    """查询 A2A Task 状态（从 Redis 或 DB 读取）"""
    ...
```

---

## 5. A2A 与 LangGraph 的桥接

```
外部调用方
    │
    │  POST /v1/agents/content_gen/tasks/send
    ▼
A2A Server (server.py)
    │  解析 Task.message → ContentGenAgent 输入
    ▼
ARQ Task Queue (agent_tasks.py)
    │  arq.enqueue("run_agent_node", agent="content_gen", input=...)
    ▼
LangGraph StateGraph
    │  graph.ainvoke(state, config={"thread_id": campaign_id})
    ▼
结果写回 Redis → A2A Task 状态更新为 completed
```

---

## 6. MCP 工具清单

```python
# app/protocols/mcp/tools.py

MCP_TOOLS = [
    {
        "name": "db_get_campaign",
        "description": "从 PostgreSQL 查询 Campaign 详情",
        "input_schema": {
            "type": "object",
            "properties": { "campaign_id": { "type": "string" } },
            "required": ["campaign_id"]
        }
    },
    {
        "name": "db_save_content_bundle",
        "description": "保存 ContentBundle 到数据库",
        "input_schema": { ... }
    },
    {
        "name": "ad_api_deploy",
        "description": "调用广告平台 API 投放广告（支持 Meta/TikTok/Google）",
        "input_schema": {
            "type": "object",
            "properties": {
                "platform": { "type": "string", "enum": ["meta", "tiktok", "google"] },
                "ad_group":  { "type": "object" }
            }
        }
    },
    {
        "name": "ad_api_pull_metrics",
        "description": "拉取广告平台数据（CTR/ROAS/CVR）",
        "input_schema": { ... }
    },
    {
        "name": "vector_search_memory",
        "description": "在 agent_memory 表的 pgvector 索引中语义检索历史经验",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "top_k": { "type": "integer", "default": 3 }
            }
        }
    }
]
```

### Claude + MCP 调用流

```python
# ContentGenAgent 节点调用示意
response = await anthropic_client.messages.create(
    model="claude-sonnet-4-6",
    tools=MCP_TOOLS,            # 注入工具定义
    messages=[
        { "role": "user", "content": prompt }
    ]
)
# Claude 返回 tool_use block → 执行对应工具函数 → 结果回传 Claude
```

---

## 7. 替换现有私有 AgentMessage 协议

`docs/04-agent-collaboration.md` 中定义的私有 `AgentMessage` 协议现已被 A2A 标准替换：

| 旧私有协议 | A2A 标准对应 |
|-----------|-------------|
| `AgentMessage { type, from, to, payload }` | `Task { id, message{role, parts[]}, status }` |
| `agent.run(input)` → output | `POST /tasks/send` → `Task(state=completed, artifacts)` |
| EventBus 事件通知 | Task status SSE 推流 |
| 自定义 traceId | `Task.metadata.trace_id` |
