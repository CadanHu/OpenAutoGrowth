# Orchestrator 页规格（FSM 可视化） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-27 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

Orchestrator 页让用户**观察和管理所有 Campaign 的状态机 (FSM) 及系统总线事件**。作为系统的中枢神经，此页面主要为 "只读/观察" 设计，未来可以加入人工干预操作。

**依赖数据源**：
1. `window.OAG.orchestrator.campaigns` (Map) - 提供 Campaign 列表和当前状态
2. `window.OAG.eventBus.history` - 提供全局事件日志

---

## 2. Tab 设计

页面分为 3 个 Tab，默认展示 Overview。

### 2.1 Tab 1: Overview (总览)
- **Top Metric Strip**:
  - `Total Campaigns`: orchestrator 中注册的总数量
  - `Active`: 状态不是 COMPLETED / PAUSED 的数量
  - `Paused/Anomaly`: 状态是 PAUSED 的数量
  - `Total Events`: eventBus.history.length
- **Campaign State Table**:
  - 渲染所有 Campaign 的列表
  - 字段：Campaign ID, Name, Status, Loops (loop_count)

### 2.2 Tab 2: FSM View (状态机可视化)
- 渲染类似于 DAG 的视图，但是展示 Campaign 的生命周期状态节点。
- 左侧列表可以选中某个 Campaign。
- 右侧画板高亮该 Campaign 的当前状态，状态节点有：`DRAFT` -> `PLANNING` -> `PENDING_REVIEW` -> `PRODUCTION` -> `DEPLOYED` -> `MONITORING` -> `OPTIMIZING` / `LOOP_N` -> `PAUSED` / `COMPLETED`。
- v0.0.2 简化：只用 CSS Grid/Flex 展示一个线性的/环形的状态流，当前状态用 `.active` 高亮。

### 2.3 Tab 3: System Logs (全局日志)
- 渲染 `eventBus.history` 中的所有事件（倒序）。
- 每一行展示：发生时间、事件类型、Campaign ID、事件负载的 JSON 预览。

---

## 3. 核心交互

1. **实时刷新**：订阅 `PlanGenerated`, `AdDeployed`, `OptimizationApplied`, `AnomalyDetected`，实时刷新 Overview 状态和 FSM 进度。
2. **状态流转观察**：能在 FSM View 中看到某个 campaign 的状态跳动。

---

## 4. UI/CSS Token 复用

- 指标卡片：复用 `.metric-row`, `.metric-box`
- 表格：复用 `.attr-table`
- 状态标签：复用 `.cred-status-*` 或者新增 `.fsm-status`
- 事件日志：复用 `.logs-view`, `.log-line`

---

## 5. 测试用例 (Smoke Tests)
1. Orchestrator 页：空状态（没有 campaign）。
2. Orchestrator 页：发布 goal 后，能在 Overview 中看到新增的 Campaign。
3. Orchestrator 页：状态机高亮能随状态切换而更新。
