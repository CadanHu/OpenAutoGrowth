# 总体架构概览 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-08 | Owner: Architecture Team

---

## 1. 系统定位

OpenAutoGrowth 是一个 **AI 驱动的增长自动化平台**，核心能力是将用户的高层级增长目标（如"新品上市推广、GMV 提升 20%"）转化为可自动执行的多平台投放活动，并通过数据反馈实现自我优化的闭环。

**解决什么问题：**
- 传统广告投放依赖人工策略和手动操作，效率低、调整慢；
- 缺乏统一的内容生产 → 投放 → 数据 → 优化的自动化链路；
- 多渠道（Meta / Google / TikTok）需要不同的操作系统，数据孤岛严重。

**核心价值主张：**
> "输入目标，输出增长" — 从用户画像分析到素材生成、投放执行、效果监控、自动优化，全程 AI Agent 自动驾驶。

---

## 2. 设计哲学

| 原则 | 说明 |
| :--- | :--- |
| **分层解耦** | 策略层与执行层严格隔离，Agent 之间通过契约通信，互不直接依赖 |
| **动态编排** | 任务流程由 Planner Agent 在运行时动态生成 DAG，而非预定义线性流程 |
| **闭环自治** | 数据分析 Agent 的输出直接触发优化 Agent，优化结果反哺 Orchestrator 重新规划 |
| **可观测性** | 每个 Agent 节点的状态、入参、输出、耗时全程可追踪，支持人工介入审批 |

---

## 3. 系统四层架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      🧠 Intelligence Layer                       │
│           Orchestrator Agent  ←→  Planner Agent                  │
│         (目标理解 / 流程控制)     (DAG 动态规划)                    │
├──────────────────────────────────────────────────────────────────┤
│                      🚀 Execution Layer                          │
│   ContentGen  │  Multimodal  │  Strategy  │  ChannelExec         │
│  (文案生成)   │ (视觉素材)   │ (投放策略) │  (平台API执行)         │
├──────────────────────────────────────────────────────────────────┤
│                      📈 Feedback Layer                           │
│             Analysis Agent  ←→  Optimizer Agent                  │
│           (数据拉取/归因)       (A/B优化/闭环驱动)                 │
├──────────────────────────────────────────────────────────────────┤
│                      🛠️  Support Layer                           │
│    Context Memory  │  Tool Registry  │  Event Bus  │  Logging    │
│   (语义记忆/历史)   │  (API 连接器)  │  (异步通信) │  (可观测)    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 技术选型

| 模块 | 技术选型 | 理由 |
| :--- | :--- | :--- |
| **前端 Dashboard** | Vanilla JS + Vite + Design Tokens | 零框架依赖、静态托管友好；详见 [docs/frontend/](../frontend/00-overview.md) |
| **Agent 编排引擎** | Node.js / Python (LangGraph 模式) | 支持异步、事件驱动、动态 DAG |
| **长期记忆** | Pinecone + PostgreSQL | 向量语义检索 + 结构化历史 |
| **Agent 通信** | Redis Pub/Sub (短期) → Kafka (规模化) | 解耦、可靠、可回溯 |
| **LLM 调用** | OpenAI GPT-4o / Anthropic Claude 3.5 | 策略规划 + 文案生成 |
| **视觉 AI** | Midjourney API / Runway Gen-3 | 高质量图片/视频素材 |
| **广告 API** | Meta Marketing API / Google Ads API / TikTok Ads | 多渠道统一执行 |
| **监控/日志** | OpenTelemetry + Grafana | 全链路 Trace |

---

## 5. 关键设计决策 (ADR)

### ADR-001: 为什么使用 DAG 而非线性流程？
- 不同目标场景的任务顺序不同（新品推广 ≠ 复购促活）；
- 部分任务可并行执行（文案生成与图片生成可同时运行）；
- Planner Agent 需要在运行时根据上下文"组装"任务图。

### ADR-002: 为什么 Orchestrator 不直接操作 API？
- 保持关注点分离，Orchestrator 只处理流程控制逻辑；
- ChannelExec Agent 专注于 API 适配和重试逻辑，减少 Orchestrator 复杂度；
- 便于单独测试各 Agent。

### ADR-003: Human-in-the-Loop 在哪里接入？
- 在 Planner → Execution 之间设置"审批门"（Review Gate）；
- 高预算活动（> $10,000）强制人工审批后才触发 ChannelExec；
- Optimizer Agent 的预算调整幅度超过 50% 时报警并等待确认。

### ADR-004: 前端为何独立成一套 SDD 规格？
- 视觉/交互演进节奏与后端 Agent 不同，前端需要自己的规格源；
- 每个 Agent 独立页面要求单一真源定义"Agent 元数据"（名字、色、描述），这是**前端关注**的组织方式；
- 前后端契约通过 `docs/architecture/10-api-spec.md` 和 WebSocket 事件 Schema 保持同步；
- 详见 [docs/frontend/00-overview.md](../frontend/00-overview.md)。
