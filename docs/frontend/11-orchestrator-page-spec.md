# Orchestrator 页规格（Advanced Multi-Agent 编排控制台） — OpenAutoGrowth

> Version: 1.1 | Updated: 2026-04-30 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.3 交付目标 (Advanced Orchestration)**

---

## 1. 页面定位

Orchestrator 页是系统的中枢神经。它不仅让用户**观察所有 Campaign 的宏观状态流转 (FSM)**，更提供了**深入 Multi-Agent 内部执行细节的显微镜**，以及**关键时刻的干预方向盘 (Human-in-the-Loop)**。

**依赖数据源**：
1. `window.OAG.orchestrator.campaigns` (Map) - 提供 Campaign 列表、当前状态及资源指标。
2. `window.OAG.eventBus` - 提供全局事件流及特定节点的进度。
3. `window.OAG.memory` - (规划中) 提供 Agent 的 LangGraph State 树及长期记忆库(pgvector)。

---

## 2. 核心模块与布局设计

页面采用 **Master-Detail (主从布局)** 或 **多维 Tab 布局**，以容纳多维度的数据监控与干预。

### 2.1 Overview (全局监控总览)
- **Top Metric Strip**: 
  - `Active/Total Campaigns`
  - `Anomalies / Pending Reviews`: 需重点关注的告警和审批。
  - `Total Token Cost`: 全局 LLM/API 资源消耗估算。
- **Campaign State Table**: 
  - 展示 ID, Name, 宏观 FSM 状态 (`DRAFT`, `PLANNING`, `OPTIMIZING` 等), 循环次数。
  - **快速干预入口**: 针对单个 Campaign 提供操作（Pause, Resume, Force Loop, Cancel）。

### 2.2 FSM & Task DAG View (宏观与微观任务流)
- **宏观 FSM (生命周期)**: 展示 Campaign 的总体阶段高亮。
- **微观 Task DAG (子任务进度板)**:
  - 选中某个 Campaign 并在 `PRODUCTION` 或 `OPTIMIZING` 阶段时，展开底层的 Planner 任务图。
  - 展示并行节点（如：`CopyGen`, `ImageGen`, `Review`）。
  - 每个节点的当前状态：`Waiting`, `Running`, `Success`, `Failed`。
  - 节点耗时 (Latency) 监控。

### 2.3 Agent Memory & Context (智能体思维透视)
- **State Inspector (共享状态树)**: 
  - 实时渲染该 Campaign 在 LangGraph 中的 `CampaignState` 内部数据结构（如 JSON 树状展示当前选定的受众、生成的文案变体）。
- **Optimization Memory (经验与长期记忆)**: 
  - 展示系统从 pgvector 中提取的关于该 Campaign 的上下文经验（如“发现某词效果不好”）。

### 2.4 Human-in-the-Loop (人工干预与控制)
- **Pending Approvals (审批队列)**:
  - 集中展示处于 `PENDING_REVIEW` 状态的 Campaign，并渲染待审核内容（AI 生成的文案、图片、预算策略）。
  - 提供 `Approve`, `Reject & Rewrite`, `Manual Edit` 按钮。
- **Intervention Controls (强制干预)**: 
  - `Pause/Resume`: 紧急暂停失控的 Campaign。
  - `Force Loop`: 强制提前触发一次优化。
  - `Cancel`: 终止任务并清理。

### 2.5 Resources, Costs & Alerts (资源与异常监控)
- **Resource Tracking (资源看板)**:
  - 估算当前 Campaign 消耗的 Token 数量、API 调用次数及总财务成本。
  - 监控各节点执行耗时，定位性能瓶颈。
- **Alerts Center (异常告警)**:
  - 监听 `AnomalyDetected` 事件，独立呈现高优告警（如：预算超标、ROAS 跌破阈值、API 鉴权失败）。
  - 提供一键跳转到问题 Campaign 的入口。
- **System Logs**: 底层的全局事件日志（折叠或放在最底层），供研发 Debug 使用。

---

## 3. 核心交互链路

1. **实时指标流**：监听并解析 Token 消耗、执行耗时更新界面。
2. **状态与 DAG 联动**：点击 Campaign 列表项，右侧/下方详细面板展示其特定 DAG 状态与 Agent 内部 Memory 树。
3. **干预闭环**：在 Pending Approvals 审批后，发送 `ActionApproved` 事件驱动 DAG 继续；点击 Pause 发送 `ForcePause` 事件，并在返回确认后更新 FSM 状态。

---

## 4. UI/CSS Token 复用

- 指标卡片：复用 `.metric-row`, `.metric-box`
- 树状视图：新增 `.json-tree`, `.memory-item`
- DAG/FSM 节点：复用 `.fsm-node`, `.dag-node`, `.node-status-running`
- 告警条目：新增 `.alert-item.critical`, `.alert-item.warning`

---

## 5. 开发实施步骤 (Implementation Steps)

1. **Phase 1**: 更新页面架构与布局，引入侧边栏/Tabs 容器。
2. **Phase 2**: 实现 `AlertsCenter` 和 `Intervention Controls`（包括人工审批队列）。
3. **Phase 3**: 实现 `Agent Memory & Context` 面板（JSON State Tree 与经验列表）。
4. **Phase 4**: 实现 `Task DAG View`（子节点任务板）与 `Resource & Cost Tracking`（性能与成本监控）。
5. **Phase 5**: 与事件总线深度集成，处理真实的生命周期与告警事件。
