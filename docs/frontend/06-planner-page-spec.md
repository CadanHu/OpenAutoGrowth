# Planner 页规格（DAG 预览 / 任务分解调试台） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-23 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

Planner 页是**任务分解的唯一权威视图**：让用户一眼看清"Orchestrator 把目标拆成了哪些 task、谁依赖谁、哪些能并行"，并提供一个安全的 **重规划沙盒**（不影响运行中的 Campaign）。

**它不是实时监控面板**。Planner 是一次性调用的（见 §4.1），DAG 本身不会随下游进度变色；"节点当前状态"信息来自 **Orchestrator 的 execution results**，不是 Planner 自己。

**路由**：`#/agents/planner`
**模块**：`src/ui/pages/agent-planner.js`
**i18n 标题**：`page_planner_title` — "Planner · 任务分解"

---

## 2. Planner 在系统中的真实交互（架构约束）

实现前必须理解这张图 —— 它决定了本页能做什么、不能做什么：

```
  User Goal
     │
     ▼
 Orchestrator.processGoal()
     │ ① 直接函数调用（非事件）
     ▼
 Planner.createPlan(input)                   ← 一次性；无订阅
     │ ② 返回 plan（含 6 个 task + dependencies + parallel_group）
     ▼
 EventBus.publish('PlanGenerated', plan)     ← 页面主要数据源
     │
     ▼
 Orchestrator.executePlan(plan)              ← Planner 已退场
     │
     ▼
 Strategy → ContentGen/Multimodal → ChannelExec → Analysis → Optimizer
     │
     └─▶ 所有下游事件回到 Orchestrator，**不回 Planner**
```

含义：

| 设计决定 | 原因 |
| :--- | :--- |
| 不展示"Planner 实时日志" | Planner 没有运行态，它只在 Campaign 创建瞬间被调用 |
| DAG 节点状态来自 Orchestrator `results[taskId]` | Planner 本身不持有这些数据 |
| Re-plan 按钮仅做**沙盒预演**（v0.0.2） | Orchestrator 目前 `_onOptimizationApplied` 只 `loop_count++`，尚未回调 `planner.createPlan()`；真正的闭环重规划是**后端 / agent 层**的改动，独立 PR |
| 不订阅 EventBus 的下游事件（`ReportGenerated` / `OptimizationApplied`） | Planner 不消费这些；页面只订阅 `PlanGenerated` |

---

## 3. 布局骨架

```
┌──────────────────────────────── Navbar ──────────────────────────────────┐
├ Breadcrumb: Hub / Agents / Planner ──────────────────────────────────────┤
├ Agent Header ────────────────────────────────────────────────────────────┤
│  [map-icon] Planner                        [scenario pill] [Re-plan ▶]  │
│  动态生成任务 DAG，拆解目标为可执行步骤。                                   │
├ Tabs: Overview | DAG | Templates | Re-plan | Runs | Logs ────────────────┤
├ Tab Panel ───────────────────────────────────────────────────────────────┤
│                                                                          │
│   (默认 DAG tab — 本页的主角)                                             │
│                                                                          │
│   ┌─────────────── Scenario: NEW_PRODUCT · 6 tasks ───────────────┐    │
│   │                                                                │    │
│   │    ┌──── parallel group: "gen" ────┐                           │    │
│   │    │                                │                           │    │
│   │  [t1]─┬──▶[t2 ContentGen]──┐      │                           │    │
│   │       │                     ├──▶ [t4 ChannelExec]─▶[t5]─▶[t6] │    │
│   │       └──▶[t3 Multimodal]──┘      │                           │    │
│   │    │                                │                           │    │
│   │    └────────────────────────────────┘                           │    │
│   │                                                                │    │
│   │  Legend: ○ pending  ● running  ✓ done  ✕ error                │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 区块规格

### 4.1 Agent Header（沿用 `agent-frame.js`）

- **Icon**：`map`（lucide 风格）
- **Status pill**：显示当前 scenario（`NEW_PRODUCT` / `RETENTION` / `BRAND_AWARENESS` / `GROWTH_GENERAL`），用 agent 身份色 `--agent-planner`
- **Run 按钮**：labeled `Re-plan`，跳转到 Re-plan tab（不直接执行）

### 4.2 Tab: Overview

3–5 个指标框 + 最近一次 plan 摘要：

| 指标 | 来源 |
| :--- | :--- |
| Current Scenario | 最新 `PlanGenerated` 事件的 `plan.scenario` |
| Tasks | `plan.tasks.length` |
| Parallel groups | `unique(plan.tasks.map(t => t.parallel_group))` 去 null |
| Runs | `eventBus.history` 里 `PlanGenerated` 事件总数 |
| Last Run | 最新事件 `occurred_at` |

摘要卡片：显示最近一次 plan 的 goal 截断、scenario、task 总数、生成时间。

### 4.3 Tab: DAG（特化 — **本页的主角**）

**数据源**：`eventBus.history` 里最新的 `PlanGenerated` 事件的 `payload.plan`。若无则空态 "还没有运行中的 Campaign — 去 Hub 启动一个，或到 Re-plan 试用场景模板"。

**渲染方案（SVG）**：

- **布局算法**：按依赖做 **层级拓扑布局**（Kahn 算法 + 分层）
  - 第 0 层：无依赖的任务
  - 第 k 层：所有依赖都在 < k 层
  - 同层节点水平排布，层间距 120px，节点间距 160px
- **节点**：
  - 矩形圆角 `--radius-md`，宽 140×高 64
  - 背景 `--bg-L1`，描边 2px
  - 描边色 = 对应 agent 的身份色（`--agent-contentgen` 等），从 `AGENTS[task.agentType]` 查
  - 左侧 4px 色条 + agent 图标 + task.id（小号）+ agentType（Fraunces 14px）
  - 如果 task 属于 parallel_group，加上角标 `∥ gen`
- **连线**：
  - SVG `<path>` 贝塞尔曲线，从上层节点下边缘到下层节点上边缘
  - 默认 stroke `rgba(139,115,85,0.35)`, width 1.5
  - 根据 Orchestrator `results[taskId]` 状态着色（见下）
- **并行组**：同一 `parallel_group` 的节点用虚线框包起来，右上角标签 `∥ group-name`
- **节点状态**（来自 `orchestrator.campaigns.get(activeCampaignId).active_tasks` 和上游 results 反推）：
  - `pending`：灰边
  - `running`：脉冲动画 `neuron-pulse-warm`，描边身份色
  - `done`：实心身份色填充 12% 透明度，加 ✓ 角标
  - `error`：`--danger` 描边 + ✕ 角标
- **交互**：
  - 悬停节点 → tooltip（task.id / agentType / dependencies / params 预览）
  - 点击节点 → 跳转 `#/agents/{mapped-id}`（需维护 agentType→route 映射）
  - 右上角工具条：`[⤢ Fit]` `[+]` `[−]` `[↻ Refresh]`

**Zoom / Pan**：v0.0.2 不做，固定 fit-to-viewport。标记为后续 TODO。

### 4.4 Tab: Templates（场景模板对比）

静态展示 `Planner._selectTemplate()` 里的 4 个模板，并排：

```
┌── NEW_PRODUCT ──┐  ┌── RETENTION ──┐  ┌── BRAND_AWARENESS ──┐  ┌── GROWTH_GENERAL ──┐
│ Strategy         │  │ ContentGen ∥   │  │ Multimodal           │  │ Strategy            │
│ ContentGen ∥     │  │ Strategy   ∥   │  │ ContentGen           │  │ ContentGen ∥        │
│ Multimodal ∥     │  │ ChannelExec    │  │ Strategy             │  │ Multimodal ∥        │
│ ChannelExec      │  │ Analysis       │  │ ChannelExec          │  │ ChannelExec         │
│ Analysis         │  │ Optimizer      │  │ Analysis             │  │ Analysis            │
│ Optimizer        │  │                │  │ Optimizer            │  │ Optimizer           │
└──────────────────┘  └────────────────┘  └──────────────────────┘  └─────────────────────┘
  6 tasks · 1 parallel   5 tasks · 1 par   6 tasks · 0 parallel      6 tasks · 1 parallel
```

每张卡片显示：
- 场景名 + 描述（"新品冷启动需要完整链路，Strategy 先行"等）
- Task 序列（带并行符 ∥）
- Trigger 关键词（`"新品"` / `"cold start"` / `"launch"`）

点击一张 → 预填到 Re-plan tab。

### 4.5 Tab: Re-plan（沙盒预演）

**作用**：允许用户改 goal / budget / constraints，调用 `planner.createPlan(input)` **仅生成新 plan 供预览**，不写入 Orchestrator，不创建 Campaign。

表单字段：
| 字段 | 默认值来源 |
| :--- | :--- |
| Goal (text) | 最近一次 plan 的 goal（可空） |
| Budget (number) | 10000 |
| KPI metric / target | ROAS / 3.0 |
| Channels (multiselect) | tiktok, meta |
| Region | US |

**提交**：
1. 调用 `window.OAG.orchestrator.planner.createPlan(input)`
2. 把结果渲染成 DAG（复用 §4.3 的 renderer），显示在表单下方
3. 顶部红字提示："预览模式 · 不会执行，不会创建 Campaign"
4. 提供按钮 `Copy as JSON`（v0.0.2 内部调试用）
5. **不**提供"应用此 plan 到当前 Campaign"—— 那是后端改动

**未来演进（明确标注）**：当 Orchestrator 的 `_onOptimizationApplied` 接入 `planner.createPlan(newInput)` 回调后（独立 PR），本 tab 新增一个 "作为下一 loop 的计划" 按钮。当前版本此按钮显示为 `disabled` + tooltip "Optimizer 回调尚未接入（v0.0.3）"。

### 4.6 Tab: Runs

`PlanGenerated` 事件历史列表，与 ContentGen/Optimizer 页的 runs list 同样结构：

- 时间戳 · scenario · task 数 · campaign id 前缀
- 点开展开 → 完整 `plan` JSON（`<pre>`）

### 4.7 Tab: Logs

该 agent 专属的事件流过滤视图 —— 只显示 `PlanGenerated` 一种事件类型（因为 Planner 只产出这一种）。保留与其他 agent 页一致的 UI 结构，但顶部加一条说明："Planner 只在 Campaign 启动时产出事件。要看全局事件流，回到 Hub。"

---

## 5. 数据流

### 5.1 挂载时

```js
// 一次性拉最新 plan
const latestPlan = eventBus.history
  .filter(e => e.event_type === 'PlanGenerated')
  .at(-1);

// 订阅后续 PlanGenerated（可能有多个 Campaign 同时跑）
const unsub = eventBus.subscribe('PlanGenerated', handler);
```

### 5.2 订阅范围

**只订阅**：
- `PlanGenerated` — 刷新 DAG 和 Runs/Logs

**不订阅**（明确）：
- `TaskCompleted` / `TaskFailed` — 如果未来接入，再从 Orchestrator 的 `campaigns` 轮询或加新事件
- `ReportGenerated` / `OptimizationApplied` — 不属于 Planner 的关注面

### 5.3 卸载时

```js
unsub();  // 单个取消订阅
```

---

## 6. 响应式

| 宽度 | 布局 |
| :--- | :--- |
| ≥ 1100px | Tabs 横排；DAG 占满宽度，节点固定尺寸 |
| 860 – 1099px | Tabs 横排；DAG 节点缩小到 120×56，间距 120px |
| < 860px | Tabs 改为横向滚动；DAG 改为纵向单列（每层一行）或开放横向滚动 |

---

## 7. 状态与边界

| 场景 | UI |
| :--- | :--- |
| 从未启动过 Campaign | DAG tab 显示空态 + CTA "去 Hub 启动" |
| 有 plan，但 Campaign 还在 PENDING_REVIEW | DAG 节点全部 `pending` 灰 |
| Campaign 运行中 | 节点按 Orchestrator `results` 着色；`active_tasks` 节点脉冲 |
| Campaign 失败 | 失败节点 ✕，下游节点灰 disabled |
| Re-plan 预演中 | DAG 下方出现第二张"预览 DAG"，不影响主 tab |

---

## 8. 可访问性

- `<h1>` 路由切换后获得焦点
- DAG 节点为 `<a href="#/agents/{id}">` 或 `<button>`，键盘可达；带 `aria-label="Open {agentType} agent"`
- SVG 连线 `aria-hidden="true"`（装饰性）
- `prefers-reduced-motion` 下关闭脉冲动画，用 `outline` 替代

---

## 9. 本迭代不做

| 项 | 延后到 |
| :--- | :--- |
| DAG zoom / pan | v0.0.3 |
| DAG 节点拖拽重排（手动覆盖拓扑） | v0.2 |
| Prompt tab（Planner 的 LLM prompt） | v0.0.3（当前 Planner 是模板选择，非 LLM；仅当 Planner 换成 LLM 驱动时才有意义） |
| Config tab（模板自定义） | v0.2 —— 需要配合后端存储 |
| 把 Re-plan 结果写回 Orchestrator 当前 Campaign | v0.0.3（需要后端 agent 层改动） |
| 跨 Campaign 的 plan 对比 | v0.2 |

---

## 10. 验收清单

- [ ] `#/agents/planner` 路由命中专属页（不是占位页）
- [ ] DAG tab 正确渲染 `plan.tasks` 的层级拓扑，依赖连线无交叉或最少交叉
- [ ] 节点按 `agentType` 使用对应身份色
- [ ] 并行组用虚线框圈出，带 `∥ group-name` 标签
- [ ] 节点点击跳转到对应 `#/agents/{id}`
- [ ] Templates tab 展示 4 个场景模板，点击可预填到 Re-plan
- [ ] Re-plan 表单提交不会改到真实 Campaign
- [ ] Runs tab 能展开看完整 plan JSON
- [ ] Logs tab 只显示 `PlanGenerated` 事件
- [ ] 无运行中 Campaign 时有明确空态与引导
- [ ] 切换语言（zh/en）文案正确
- [ ] `prefers-reduced-motion` 下脉冲动画关闭

---

## 11. 依赖与风险

**依赖**：
- `src/ui/pages/agent-frame.js`（已存在）
- `src/ui/agent-registry.js`（已存在，含 `planner`/`content-gen` 等身份色）
- 现有 `planner` 实例可从 `window.OAG.orchestrator.planner` 取到 —— 需要在 `main.js` 把 `planner` 暴露出来（当前已通过 `orchestrator` 间接可达，`main.js` 第 65 行的 `window.OAG` 不含 `planner` 字段；实现时视需要补上）

**风险**：
- Orchestrator 未提供任务完成事件，节点"done"状态要靠轮询 `campaigns.get(id).active_tasks` 的反向推导 —— 可能与实际状态有 < 1s 滞后。**接受该误差**，v0.0.3 引入 `TaskCompleted` 事件后自然消除。
- SVG 连线的路径避让算法不做高级处理；层级超过 4 层时可能有连线交叉。若验收发现严重交叉，再引入 `dagre` 库（会增加约 20KB gzip）。
