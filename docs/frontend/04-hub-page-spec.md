# Hub 页规格（总览 / 编排中枢） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-22 | Owner: Frontend Team
> Status: Draft (SDD) — **本迭代交付**

---

## 1. 页面定位

Hub 是前端唯一的**全局视图**：一屏表达"**当前系统在干什么、做得怎么样、下一步怎么动手**"。

它同时是所有 Agent 页面的**入口总台**——点击任何一个 Agent 节点 / 卡片都能直达对应 Agent 页。

**路由**：`#/`
**模块**：`src/ui/pages/hub.js`
**i18n 标题**：`page_hub_title` — "总览 Orchestration Hub"

---

## 2. 布局骨架

```
┌───────────────────────────────── Navbar (Shell) ──────────────────────────────┐
│                                                                                │
├─────────────────────────── Hero ──────────────────────────────────────────────┤
│                                                                                │
│                  Intelligent Growth,                                          │
│                     At Your Command.                                          │
│                                                                                │
│      Input your goal. Our 8 agents will plan, produce,                        │
│           deploy, measure, and optimize — on loop.                            │
│                                                                                │
│                 [ 🌱  Launch Campaign ]                                        │
│                                                                                │
├───────────────────── Campaign Status Strip ───────────────────────────────────┤
│  CURRENT CAMPAIGN · C_A8F3 │ PLANNING → EXECUTING │ Budget 32% │ Health ● 良好 │
├───────────────────────── Orchestration Canvas ────────────────────────────────┤
│                                                                                │
│                              [Strategy]                                        │
│                                   │                                           │
│         [Orchestrator]──[Planner]─┼─[ContentGen]──[Reviewer]──[Execution]     │
│                                   │                              │            │
│                              [Multimodal]                    [Optimizer]←─┐  │
│                                                                  │         │  │
│                                                              [Analysis]───┘  │
│                                                                                │
│         (每个节点点击 → 跳转对应 /agents/{id})                                  │
│                                                                                │
├─────────────────────── Agent Summary Grid ────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │ Strategy │  │ ContentGn│  │ Multimod │  │ ChannelEx│                     │
│  │ 3 plans  │  │ 12 var   │  │ 8 assets │  │ 87% reach│                     │
│  │ Open →   │  │ Open →   │  │ Open →   │  │ Open →   │                     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │ Analysis │  │ Optimizer│  │ Planner  │  │ Orchestr │                     │
│  │ ROI +42% │  │ 3 cycles │  │ DAG v2   │  │ IDLE     │                     │
│  │ Open →   │  │ Open →   │  │ Open →   │  │ Open →   │                     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                     │
│                                                                                │
├──────────────────────── Activity Log ─────────────────────────────────────────┤
│  10:42:18  Plan generated — 5 tasks scheduled                                 │
│  10:42:33  Strategy decided — channels: TikTok, Meta                          │
│  10:43:01  3 copy variants produced                                           │
│  ...                                                                           │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 区块规格

### 3.1 Hero

| 属性 | 值 |
| :--- | :--- |
| 背景 | `--bg-L0` |
| 上下 padding | `--sp-8` |
| 主标题 | Fraunces 48px / semibold，`--text-primary` |
| 副标题 | Inter 17px / regular，`--text-secondary`，最大宽度 560px，居中 |
| CTA 按钮 | Primary Button，圆角 `--radius-md`，图标 `sprout`（有机感） |
| CTA 行为 | 打开现有 `#launch-modal` |

**文案**（默认中文，带 i18n key）：

- `hero_title_new`（主）：`智能增长，触手可及。`
- `hero_subtitle_new`（副）：`定义目标，8 个智能体协作完成 规划 · 生产 · 投放 · 归因 · 优化 的闭环。`
- `btn_launch_new`：`Launch Campaign`

### 3.2 Campaign Status Strip

**状态**：条状组件，横贯页面，位于 Hero 和 Canvas 之间。

| 字段 | 来源 |
| :--- | :--- |
| Campaign ID | `activeCampaignId` 截取前 6 位 |
| 状态链 | `StatusChanged` 事件历史（最近 2 档） |
| 预算进度 | `metrics.spent / budget.total`（如可得） |
| 健康度 | 规则：无异常 = 良好；有 ANOMALY = 注意 |

**无活动时**：显示引导 "暂无运行中活动，点击 Launch 开始。"

### 3.3 Orchestration Canvas（DAG）

**保留**现有 `pipeline-canvas-grid` + `pipeline-svg-overlay` 结构，但：

1. 节点 emoji 换成**线性 SVG 图标**（见 `01-design-system.md` §8）
2. 节点默认状态改为米色系：
   - 默认：背景 `--bg-L2`、描边 `--border-default`、图标 `--text-secondary`
   - active：背景 `--accent-soft`、描边 `--accent-primary`、图标 `--accent-primary`
   - working：加呼吸动画 `neuron-pulse-warm`（暖琥珀色 halo）
3. 连线色：默认 `rgba(139,115,85,0.15)`；active 时 `--accent-primary` + 流动粒子
4. **新增交互**：节点 hover 出现 tooltip；点击跳转 `#/agents/{id}`
5. **边框 reviewer**：保留审批门视觉，用 `--warning` 色

**节点点击映射**：

| DOM id | 跳转路由 |
| :--- | :--- |
| `node-orchestrator` | `#/agents/orchestrator` |
| `node-planner` | `#/agents/planner` |
| `node-strategy` | `#/agents/strategy` |
| `node-contentgen` | `#/agents/content-gen` |
| `node-multimodal` | `#/agents/multimodal` |
| `node-reviewer` | （保留，v0.2 实现） |
| `node-channelexec` | `#/agents/channel-exec` |
| `node-analysis` | `#/agents/analysis` |

（注：现有代码里 Optimizer 节点 id 是 `node-analysis`，容易误会；本次**不改 id**避免 JS 断裂，仅在 spec 中保留一条"重命名"TODO 至 v0.2。）

### 3.4 Agent Summary Grid

**8 张迷你卡**（取代原 4 张大卡）。每张卡：

```
┌─────────────────────────┐
│ [icon]  Agent Name      │  ← Agent 身份色图标 + Fraunces 18
│                         │
│ 核心指标 大字 24px      │
│ 指标说明 small tertiary │
│                         │
│ ─────────────────────── │  ← border-subtle
│ 最近事件  ·  2 min ago  │
│                         │
│            Open  →      │  ← ghost 按钮，右下角
└─────────────────────────┘
```

每张卡片**独立数据源**，从 EventBus / Memory 拉取：

| Agent | 指标 | Event Source |
| :--- | :--- | :--- |
| Strategy | 当前策略版本 / 渠道数 | `StrategyDecided` |
| ContentGen | 已产出变体数 | `ContentGenerated` |
| Multimodal | 视觉资产数 | `AssetsGenerated` |
| ChannelExec | 触达率 / 投放平台数 | `AdDeployed` |
| Analysis | ROAS / CTR | `ReportGenerated` |
| Optimizer | 循环次数 / 最近动作 | `OptimizationApplied` |
| Planner | 当前 DAG 版本 / 任务数 | `PlanGenerated` |
| Orchestrator | 当前状态 | `StatusChanged` |

点击卡片任意位置 → 跳转 `#/agents/{id}`。

**网格**：`repeat(auto-fit, minmax(220px, 1fr))`，间距 `--sp-5`。

### 3.5 Activity Log

结构保留，但改造样式：

- 背景 `--bg-L2`，圆角 `--radius-lg`
- 条目：`border-left 2px solid` + 语义色（success / warning / danger / info）
- 字体 `--fs-sm`，时间戳 `--text-tertiary` 左对齐
- 滚动容器高度 `240px`
- 标题 "实时事件" + 绿色 `● Live` 徽章

---

## 4. 数据流

### 4.1 订阅事件（挂载时）

```js
const unsub = [];
unsub.push(globalEventBus.subscribe('StatusChanged', onStatusChange));
unsub.push(globalEventBus.subscribe('PlanGenerated', onPlanGenerated));
// ... 8 类事件
```

### 4.2 卸载时（离开 Hub）

```js
unmount() {
  unsub.forEach(fn => fn());
  this._stopAnimationTimers();
}
```

### 4.3 WebSocket

如 `activeCampaignId` 存在，订阅该 campaign 的 WS；离开页面时 `wsBroadcaster.unsubscribe(id)`。

---

## 5. 响应式断点

| 宽度 | 布局变化 |
| :--- | :--- |
| ≥ 1200px | 3 区全宽（Canvas 横铺、Grid 4 列） |
| 960 – 1199px | Grid 变 3 列；Canvas 保持 |
| 720 – 959px | Grid 变 2 列；Canvas 缩放 0.85 |
| < 720px | Grid 变 1 列；Canvas 改为横向滚动（不压缩） |

---

## 6. 状态与边界

| 场景 | UI 处理 |
| :--- | :--- |
| 首次进入，无 Campaign | Strip 显示引导；Canvas 全灰；Grid 显示 `—` |
| Campaign 运行中 | Strip 实时更新；Canvas 亮起 active 节点；Grid 数字跳动 |
| WS 断开 | Strip 右侧改 `● 连接中断（重试）`；Log 尾部出错提示 |
| 加载失败（API 错误） | 整页 toast 提示；Grid 单卡片显示"加载失败"状态 |

---

## 7. 可访问性

- `<h1>` 在 Hero 内，路由切换后获得焦点；
- 每个 Agent 卡片是 `<a href="#/agents/{id}">`，原生键盘可达；
- DAG 节点为 `<button>`，附带 `aria-label="Open ContentGen agent"`；
- 动效在 `prefers-reduced-motion` 下关闭（粒子流、neuron-pulse）。

---

## 8. 本迭代不做（明确范围）

| 项 | 延后到 |
| :--- | :--- |
| Agent 专属页内容 | v0.2（但路由需命中占位页） |
| Campaign 详情页 | v0.2 |
| Reviewer（审批门）交互 | v0.2 |
| 实时图表升级（目前仍是 CSS bar） | v0.2+ |
| History/Campaign 模态框视觉全面换肤 | 本迭代仅替换 Token，布局不改 |

---

## 9. 验收清单

- [ ] 页面路由 `#/` 渲染 Hub，刷新后正确加载
- [ ] 所有背景色来自 L0–L3 Token，无写死
- [ ] 所有 emoji 替换为线性 SVG 图标
- [ ] 8 个 Agent 节点可点击，跳转到对应 `#/agents/{id}`（即使是占位页）
- [ ] Status Strip 响应 `StatusChanged` 事件实时刷新
- [ ] Agent Summary Grid 8 张卡各自订阅对应事件
- [ ] Activity Log 保持原功能，仅视觉换肤
- [ ] 切换语言（ZH/EN）文案正确
- [ ] `prefers-reduced-motion` 下动效关闭
- [ ] Lighthouse Accessibility ≥ 95
