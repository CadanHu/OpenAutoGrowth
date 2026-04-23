# 前端架构概览 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-22 | Owner: Frontend Team
> Status: Draft (SDD — Spec-Driven Development)

---

## 1. 系统定位

前端是 OpenAutoGrowth 多智能体闭环引擎的**操作控制台**。它承载两类核心交互：

1. **全局编排视图（Hub）** — 一眼看懂 8 个 Agent 当前的协作状态、Campaign 生命周期、数据闭环进度。
2. **单 Agent 专属视图** — 每个 Agent 拥有独立页面，用于参数调校、手动触发、历史追踪、产物检视，便于**独立迭代**而不影响其它 Agent。

这次重设计的目标：**从"一屏堆砌的仪表盘"演进为"有机的、分层的、可逐点优化的工作台"**。

---

## 2. 设计哲学

| 原则 | 说明 |
| :--- | :--- |
| **有机宁静** | 以暖奶油/米色为基底，避免夜色仪表盘的冷峻；用分层（而非高对比）建立层次 |
| **分层可见** | 至少 4 层背景色，用深浅变化表达信息层级，而非靠边框/阴影轰炸 |
| **Agent 自治** | 每个 Agent 有专属页面；新增/改造一个 Agent 只影响对应的 `pages/agent-*.js` |
| **单向数据流** | UI 只订阅 EventBus / WebSocket，不直接操纵 Agent 内部状态 |
| **渐进增强** | 先做 Hub，再按需逐个上 Agent 页；未实现的页面展示"即将上线"占位 |

---

## 3. 前端架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                   🎨 Presentation Layer                      │
│        Pages (Hub / Agent-*)  │  Shared Components           │
│       [src/ui/pages/*.js]     │  [src/ui/components/*.js]    │
├─────────────────────────────────────────────────────────────┤
│                   🧭 Routing & Shell                         │
│        Hash Router  │  AppShell (Navbar / Footer)            │
│     [src/ui/router.js]   [src/ui/shell.js]                  │
├─────────────────────────────────────────────────────────────┤
│                   🎛️ Design System                           │
│     Design Tokens  │  Component Styles  │  Icon Set          │
│     [src/ui/tokens.css]     [src/ui/components.css]         │
├─────────────────────────────────────────────────────────────┤
│                   🔌 Integration Layer                       │
│      EventBus subscribers  │  API client  │  i18n            │
│      [src/core/EventBus.js] [src/api/*]  [src/i18n/*]        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 技术选型

| 模块 | 选型 | 理由 |
| :--- | :--- | :--- |
| **构建工具** | Vite 6.x | 已就绪；ESM 原生、HMR 快 |
| **框架** | 原生 JS（Vanilla） | 现状保持；避免引入 React 成本 |
| **路由** | 自研 Hash Router | 零依赖、静态部署友好；见 `03-routing.md` |
| **样式** | Design Tokens + CSS Modules(手工命名空间) | 无 Tailwind/UnoCSS；主题可替换 |
| **图标** | Lucide-style 线性 SVG（内联） | 去 emoji；与有机/宁静主题一致 |
| **字体** | Fraunces（衬线·标题）+ Inter（正文） | 有机、高端、可读 |
| **状态管理** | EventBus + 页面局部状态 | 无 Redux；`src/core/EventBus.js` 已存在 |

---

## 5. 关键设计决策 (ADR)

### ADR-F001: 为什么用 Hash Router 而非 History API？
- **部署简单**：`vite build` 产物可直接静态托管，无需服务端 rewrite 规则；
- **无需后端配合**：当前 `index.html` 是单 entry，hash 切换零成本；
- **向后兼容**：之后若迁移到 History API，只需换 Router 实现，页面模块不变。

### ADR-F002: 为什么每个 Agent 独立页面？
- **独立迭代**：Optimizer 的规则面板和 ContentGen 的 Prompt 调校形态完全不同，强行统一会丢细节；
- **权限/角色分离**（未来）：运营只看 Hub、算法工程师深入 Agent 页；
- **调试友好**：可直接 `#/agents/optimizer` 深链分享给协作者。

### ADR-F003: 为什么不引入 React / Vue？
- 当前功能（DAG 可视化、事件订阅、表单）用原生 JS 已够用；
- 引入框架会需要重写 `main.js` 的 `DashboardController`、Router、事件订阅链；
- Hub + 8 Agent 页 ≈ 9 个模板，规模上不需要 VDOM。

### ADR-F004: 为什么要替换配色（从深色 → 奶油米色）？
- **品牌差异化**：大量 AI 工具都是深色仪表盘，奶油色建立独特视觉语言；
- **信任感/温度**：To-B 增长工具给运营日常使用，冷色会增加疲劳；
- **分层表达力**：多层次米色（L0–L3）用深浅自然划分信息层级，不靠重型阴影。

### ADR-F005: 为什么先做 Hub？
- Hub 是唯一**全部用户都会访问**的页面；
- Hub 落地后可验证新 Design Token 体系、Router、Shell 三件基建；
- Agent 页共用上述基建，之后铺开的成本仅为每页 UI 本身。

---

## 6. 目录结构（目标态）

```
src/
├── ui/
│   ├── tokens.css              # Design Tokens（颜色/字号/间距/阴影）
│   ├── components.css          # 通用组件样式
│   ├── shell.js                # AppShell：Navbar + Footer + Router Outlet
│   ├── router.js               # Hash Router
│   ├── icons.js                # 内联 SVG 图标集
│   ├── components/
│   │   ├── card.js             # 通用卡片
│   │   ├── stat.js             # 指标块
│   │   ├── timeline.js         # 活动日志时间线
│   │   ├── dag.js              # DAG 可视化组件
│   │   └── ...
│   └── pages/
│       ├── hub.js              # 总览页
│       ├── agent-strategy.js   # 策略 Agent
│       ├── agent-planner.js
│       ├── agent-content-gen.js
│       ├── agent-multimodal.js
│       ├── agent-channel-exec.js
│       ├── agent-analysis.js
│       ├── agent-optimizer.js
│       └── campaigns.js        # 活动历史
```

> 现阶段（本迭代）只落地 `tokens.css`、`components.css`、`shell.js`、`router.js`、`pages/hub.js`，其它 agent 页面仅做占位（进入显示 "即将上线"）。

---

## 7. 与后端的边界

前端**只**通过三条通道与后端交互：

1. **REST API** — `src/api/routes.js` → `CampaignAPI`（已存在，不修改契约）
2. **WebSocket** — `src/api/websocket.js` → `wsBroadcaster`（已存在）
3. **Static Assets** — `/public` 下的 favicon 等

Agent 的业务逻辑、Prompt、规则引擎**全部在后端**；前端只做呈现和触发。

---

## 8. 相关文档

| 文档 | 核心内容 |
| :--- | :--- |
| [01 设计系统](./01-design-system.md) | 色板、字体、间距、阴影、圆角、图标 |
| [02 信息架构](./02-information-architecture.md) | 页面树、导航、面包屑、深链 |
| [03 路由机制](./03-routing.md) | Hash Router 实现规范 |
| [04 Hub 页规格](./04-hub-page-spec.md) | 总览页详细规格（本次实现） |
| [05 Agent 页模板](./05-agent-page-template.md) | 单 Agent 页通用骨架（后续铺开） |
