# 信息架构 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-22 | Owner: Frontend Team
> Status: Draft (SDD)

---

## 1. 用户场景与入口

| 场景 | 主要用户 | 入口 | 期望 |
| :--- | :--- | :--- | :--- |
| **观察全局进度** | 运营主管 | `/` (Hub) | 看当前 Campaign 在哪个 Agent、闭环健康度 |
| **深入调 Agent** | 策略/算法 | `/agents/{id}` | 查看/修改该 Agent 的 Prompt、规则、历史 |
| **回溯活动** | 运营 / 财务 | `/campaigns` | 历史 Campaign 列表、ROI、消耗 |
| **启动新活动** | 运营 | Hub 上的 `Launch` 按钮 → Modal | 快速录入 URL + 预算 + KPI |

---

## 2. 页面树

```
/                                 ← Hub（总览）
│
├── /agents/orchestrator          ← 中枢
├── /agents/planner               ← DAG 规划
├── /agents/strategy              ← 策略
├── /agents/content-gen           ← 文案生成
├── /agents/multimodal            ← 视觉素材
├── /agents/channel-exec          ← 渠道执行
├── /agents/analysis              ← 数据分析
├── /agents/optimizer             ← 闭环优化
│
├── /campaigns                    ← 活动历史
└── /campaigns/:id                ← 单活动详情（v0.2）
```

**本迭代只实现 `/`（Hub）**；其它路由命中时进入占位页"即将上线"。

---

## 3. 路由表（权威清单）

| Route | Page 模块 | i18n 标题 key | 状态 |
| :--- | :--- | :--- | :--- |
| `#/` | `pages/hub.js` | `page_hub_title` | ✅ 本迭代 |
| `#/agents/orchestrator` | `pages/agent-orchestrator.js` | `page_orchestrator_title` | 🚧 占位 |
| `#/agents/planner` | `pages/agent-planner.js` | `page_planner_title` | 🚧 占位 |
| `#/agents/strategy` | `pages/agent-strategy.js` | `page_strategy_title` | 🚧 占位 |
| `#/agents/content-gen` | `pages/agent-content-gen.js` | `page_contentgen_title` | 🚧 占位 |
| `#/agents/multimodal` | `pages/agent-multimodal.js` | `page_multimodal_title` | 🚧 占位 |
| `#/agents/channel-exec` | `pages/agent-channel-exec.js` | `page_channelexec_title` | 🚧 占位 |
| `#/agents/analysis` | `pages/agent-analysis.js` | `page_analysis_title` | 🚧 占位 |
| `#/agents/optimizer` | `pages/agent-optimizer.js` | `page_optimizer_title` | 🚧 占位 |
| `#/campaigns` | `pages/campaigns.js` | `page_campaigns_title` | 🚧 占位 |

未匹配路由 → 重定向到 `#/`。

---

## 4. 导航结构

### 4.1 Navbar（所有页面共享）

```
┌─────────────────────────────────────────────────────────────────┐
│  🌱 OpenAutoGrowth   │   Hub  Agents▼  Campaigns   │  ZH/EN  ●  │
└─────────────────────────────────────────────────────────────────┘
```

- **Logo**（点击回 Hub）
- **主导航三项**：Hub / Agents（带下拉 8 项） / Campaigns
- **右侧状态区**：语言切换 / 当前 Campaign 徽章 / Agent 在线指示灯

### 4.2 Agents 下拉菜单

结构化分组：

```
▾ Agents
  ├─ Intelligence
  │   ├─ Orchestrator
  │   └─ Planner
  ├─ Execution
  │   ├─ Strategy
  │   ├─ ContentGen
  │   ├─ Multimodal
  │   └─ ChannelExec
  └─ Feedback
      ├─ Analysis
      └─ Optimizer
```

分组对应后端四层架构（见 `docs/architecture/00-overview.md` §3）。

### 4.3 面包屑（Agent 页使用）

```
Hub  /  Agents  /  ContentGen
```

---

## 5. Hub 页顶层布局

详见 [`04-hub-page-spec.md`](./04-hub-page-spec.md)。高层结构：

```
┌─ Navbar ──────────────────────────────────────────────┐
│                                                        │
├─ Hero ────────────────────────────────────────────────┤
│  标题 + 副标题 + Launch Campaign 主 CTA                │
│                                                        │
├─ Orchestration Canvas ────────────────────────────────┤
│  DAG 神经网络（8 Agent 节点可点击跳转对应 Agent 页）   │
│                                                        │
├─ Campaign Status Strip ──────────────────────────────┤
│  当前活动 ID / KPI / 预算进度 / 健康度                  │
│                                                        │
├─ Agent Summary Grid ──────────────────────────────────┤
│  8 张简卡：每 Agent 的关键指标 + "打开" 链接            │
│                                                        │
├─ Activity Log ────────────────────────────────────────┤
│  全局事件流                                            │
└────────────────────────────────────────────────────────┘
```

---

## 6. Agent 页通用骨架

详见 [`05-agent-page-template.md`](./05-agent-page-template.md)。预览：

```
┌─ Navbar ──────────────────────────────────────────────┐
├─ Breadcrumb ──────────────────────────────────────────┤
├─ Agent Header ────────────────────────────────────────┤
│   [Icon] Agent Name           [Status: ONLINE] [Run ▶] │
│   描述一句话                                            │
├─ Tabs: Overview | Config | Runs | Prompt | Logs ──────┤
├─ Tab Content ─────────────────────────────────────────┤
└────────────────────────────────────────────────────────┘
```

---

## 7. 深链（Deep Link）契约

- `#/agents/optimizer?campaign=<id>` → 打开 Optimizer 并预选 campaign
- `#/agents/content-gen?article=<id>` → 打开 ContentGen 并加载该 article 历史

Router 负责解析 query 并传入页面 `mount(params, query)` 接口。

---

## 8. 状态持久化

- 当前 Campaign ID、语言偏好 → `localStorage`
- 活动日志 → 内存（页面切换保留；刷新后清空；后期可改 `sessionStorage`）
- Agent 页打开的 tab → URL `?tab=config` 同步

---

## 9. 可访问性的信息架构要求

- 路由变化时 **更新 `document.title`**
- 路由变化时 **聚焦页面 `<h1>`**（屏幕阅读器）
- Navbar 当前路由高亮 `aria-current="page"`
- 下拉菜单支持键盘（Tab / Arrow / Esc）
