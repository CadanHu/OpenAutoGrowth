# 09 — 后端技术栈选型决策

> Version: 1.0 | Date: 2026-04-09

## 1. 架构全景

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend      Vite + Vanilla JS               :7373             │
├──────────────────────────────────────────────────────────────────┤
│  Backend       FastAPI  Python 3.12            :9393             │
│                                                                  │
│  ┌─ Orchestration ────────────────────────────────────────────┐  │
│  │  LangGraph StateGraph                                      │  │
│  │  → 内部 DAG 执行 + PostgreSQL AsyncCheckpointer           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Protocol Layer ───────────────────────────────────────────┐  │
│  │  A2A  → Agent 间标准通信协议 / AgentCard 服务发现          │  │
│  │  MCP  → Agent 工具调用（DB / Ad API / Claude）             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  LLM          Anthropic Claude SDK (claude-sonnet-4-6)          │
│  Task Queue   ARQ + Redis  (长时 Agent 任务异步化)               │
│  WebSocket    FastAPI native WS + Redis Pub/Sub                  │
│  ORM          SQLAlchemy 2.0 async + asyncpg                     │
│  Migration    Alembic                                            │
├──────────────────────────────────────────────────────────────────┤
│  Database      PostgreSQL 15 + pgvector extension                │
│  Cache/Queue   Redis 7                                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 选型决策记录

### 2.1 后端框架：FastAPI vs Fastify (Node.js/TS)

| 维度 | FastAPI | Fastify |
|------|---------|---------|
| LLM SDK 支持 | ✅ Python 原生优先 | 🟡 JS SDK 功能滞后 |
| Agent 框架生态 | ✅ LangGraph/CrewAI/AutoGen | ❌ 无成熟等价物 |
| pgvector 集成 | ✅ asyncpg + pgvector-python | 🟡 较弱 |
| 自动 API 文档 | ✅ OpenAPI 零配置生成 | 🟡 需插件 |
| 现有 JS Agent 代码可复用性 | ⚪ 全是 mock 层，重写成本低 | ✅ 可复用骨架 |

**决策：FastAPI**
项目核心价值在 AI Agent 智能决策，而非 API 吞吐。Python 生态在 LLM、向量检索、Agent 框架上无可替代。现有 JS Agent 全为 `_simulateLatency()` 的模拟层，无真实逻辑可复用。

### 2.2 Agent 编排：LangGraph vs CrewAI vs AutoGen

| 框架 | 编排模型 | 契合度 |
|------|----------|--------|
| **LangGraph** | 有状态 DAG (StateGraph) | ⭐⭐⭐⭐⭐ |
| CrewAI | 角色驱动 | ⭐⭐⭐ DAG 控制弱 |
| AutoGen | 对话式多 Agent | ⭐⭐ 非 DAG |

**决策：LangGraph**
`Orchestrator.js` 的核心设计已是依赖图（tasks + dependencies[]）。LangGraph `StateGraph` 是其生产级实现。额外收益：PostgreSQL AsyncCheckpointer 可直接用已有 `agent_memory` 表。

### 2.3 协议层：ADK 排除原因

Google ADK 排除理由：
- 编排模型为树形层级（sequential/parallel/loop），不支持任意 DAG
- 优化 Gemini，本项目使用 Claude
- 完整功能依赖 Google Cloud（Vertex AI）
- LangGraph 已完整覆盖 ADK 的 Agent 编排能力

### 2.4 A2A Protocol 采用原因

- Linux Foundation 治理，150+ 组织支持（含 LangChain）
- 与 MCP 互补：MCP=Agent↔Tool，A2A=Agent↔Agent
- 替换私有 AgentMessage 协议，获得未来跨框架互操作性
- LangGraph agents 可通过薄包装层暴露为 A2A 端点

### 2.5 任务队列：ARQ vs Celery

**决策：ARQ**
LLM 调用（ContentGen）和数据分析（Analysis）是异步长时任务（10-60s）。Celery 是同步的，需要 greenlet 兼容层。ARQ 是纯 asyncio，与 FastAPI + LangGraph 的异步模型零摩擦，复用已有 Redis 实例。

---

## 3. 依赖版本锁定

```toml
# 核心
fastapi = "^0.115"
uvicorn = { extras = ["standard"], version = "^0.32" }
pydantic = "^2.9"
pydantic-settings = "^2.6"

# 数据库
sqlalchemy = { extras = ["asyncio"], version = "^2.0" }
asyncpg = "^0.30"
alembic = "^1.14"

# Agent / LLM
langgraph = "^0.2"
langchain-anthropic = "^0.3"
anthropic = "^0.40"

# 协议
httpx = "^0.28"          # A2A HTTP 客户端
mcp = "^1.0"             # MCP SDK

# 基础设施
redis = { extras = ["hiredis"], version = "^5.2" }
arq = "^0.26"

# 工具
python-dotenv = "^1.0"
structlog = "^24.4"
```

---

## 4. 目录结构

```
backend/
├── main.py                    # FastAPI 应用入口
├── pyproject.toml
├── .env.example
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/
└── app/
    ├── config.py              # Pydantic Settings
    ├── database.py            # 异步 engine + session
    ├── models/                # SQLAlchemy ORM 模型
    │   ├── campaign.py        # campaigns, plans, tasks
    │   ├── content.py         # style_guides, content_bundles, copies, assets
    │   ├── ad.py              # ad_campaigns, ad_groups, ads
    │   ├── analytics.py       # performance_reports, channel_stats, variant_stats, anomalies
    │   ├── optimization.py    # optimization_records, rules, opt_loops
    │   └── user.py            # organizations, users
    ├── schemas/               # Pydantic 请求/响应模型
    │   ├── campaign.py
    │   ├── agent.py
    │   └── a2a.py             # A2A AgentCard / Task / Message
    ├── api/                   # FastAPI 路由
    │   ├── router.py          # 汇总所有路由
    │   ├── campaigns.py       # /v1/campaigns
    │   ├── agents.py          # /v1/agents (A2A endpoints)
    │   └── ws.py              # WebSocket /ws/{campaign_id}
    ├── agents/                # LangGraph 图定义
    │   ├── state.py           # CampaignState TypedDict
    │   ├── graph.py           # 构建 StateGraph
    │   ├── planner.py
    │   ├── content_gen.py
    │   ├── multimodal.py
    │   ├── strategy.py
    │   ├── channel_exec.py
    │   ├── analysis.py
    │   └── optimizer.py
    ├── core/                  # 支撑层
    │   ├── event_bus.py       # Redis Pub/Sub
    │   ├── rule_engine.py     # 规则引擎（Python 移植）
    │   └── memory.py          # pgvector 语义记忆
    ├── protocols/
    │   ├── a2a/
    │   │   ├── models.py      # A2A Pydantic 模型
    │   │   ├── server.py      # A2A 端点处理器
    │   │   └── cards/         # 各 Agent 的 AgentCard JSON
    │   └── mcp/
    │       └── tools.py       # MCP 工具定义
    └── tasks/
        └── agent_tasks.py     # ARQ 异步任务
```
