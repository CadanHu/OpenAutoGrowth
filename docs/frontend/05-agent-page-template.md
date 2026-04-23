# Agent 页通用模板 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-22 | Owner: Frontend Team
> Status: Draft (SDD) — 本迭代仅建"占位页"，具体填充见后续 PR

---

## 1. 设计意图

**每个 Agent 一页** 的目的：让一个 Agent 的**配置、运行、观察、调试**在同一屏完成。

非目标：这不是一个"表单页 + 只读视图"的堆叠，而是**可操作的工作台**，支持：
- 调整参数（Prompt / 阈值 / 模型选择）
- 手动触发一次运行
- 查看历史 runs 的输入、输出、耗时、token 消耗
- 查看 / 筛选该 Agent 的事件流

---

## 2. 通用骨架

```
┌─ Navbar（Shell）────────────────────────────────────┐
├─ Breadcrumb：Hub / Agents / {Name} ─────────────────┤
├─ Agent Header ──────────────────────────────────────┤
│  [color-dot] Agent Name                 [Status] [Run ▶]
│  一句话描述。                                         │
├─ Tab Bar：Overview | Config | Runs | Prompt | Logs ──┤
├─ Tab Panel ─────────────────────────────────────────┤
│                                                      │
│   （不同 tab 内容不同，见下）                          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- 头部高度固定 120px；
- 所有 Agent 共用这套骨架，以 `AgentPageFrame(agent)` 组件工厂生成。

---

## 3. 五个 Tab 的通用内容

### 3.1 Overview（概览）
- Agent 最新状态
- 关键指标 3–6 个（每 Agent 不同）
- 最近 1 次 run 的摘要
- 快捷入口：Run Again / 打开关联 Campaign

### 3.2 Config（配置）
- 可调参数表单（来源：后端 `/agents/{id}/config`）
- 模型选择下拉（gpt-4o / claude / gemini / ...）
- 阈值滑块（Optimizer、Analysis 专用）
- "保存" 按钮 → POST `/agents/{id}/config`

### 3.3 Runs（历史运行）
- 时间线列表：时间戳 / 入参摘要 / 输出摘要 / 状态（成功/失败）/ 耗时 / 花费
- 点击条目展开详情（JSON viewer）
- 失败条目展示 stack trace

### 3.4 Prompt（提示词）
- 只对 LLM-backed Agent 出现（ContentGen / Strategy / Planner / Optimizer）
- 可编辑 Prompt 模板（支持变量 `{{goal}}`）
- 版本管理：列出历史版本 + diff

### 3.5 Logs（日志）
- 该 Agent 专属的 EventBus 事件流
- 支持过滤：info / warning / error
- 导出 JSON

---

## 4. 每 Agent 定制化

| Agent | 特有 Tab / 区块 |
| :--- | :--- |
| Orchestrator | +"状态机可视化"（显示 Campaign FSM 当前位置） |
| Planner | +"DAG 预览"（可手动触发重规划） |
| Strategy | +"策略推演"（what-if：改预算看策略变化） |
| ContentGen | +"Variant Playground"（即时生成对比） |
| Multimodal | +"Asset Library"（素材库） |
| ChannelExec | +"Channel Credentials"（API Key 状态） |
| Analysis | +"Attribution Model"（归因模型选择器） |
| Optimizer | +"Rules Inspector"（规则命中情况） |

每个特化内容各自在对应 `pages/agent-*.js` 内实现；模板只负责骨架。

---

## 5. 占位页（本迭代交付）

### 5.1 用途

在 v0.1，未实现的 agent 页命中 `#/agents/{id}` 时，展示统一"即将上线"占位页，保证：

- 导航不断裂
- Agent 色块、头部样式已就位（视觉验证 Token）
- 描述和"回到 Hub"按钮

### 5.2 占位页视觉

```
┌─────────────────────────────────────────────────┐
│  Hub / Agents / ContentGen                       │
│                                                  │
│  [color-dot]  ContentGen                         │
│  文案生成智能体                                   │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │                                            │ │
│  │         ◯  即将上线                         │ │
│  │                                            │ │
│  │  该 Agent 的独立工作台正在开发中。           │ │
│  │  完整工作台将支持配置、运行、历史、日志。     │ │
│  │                                            │ │
│  │             [← 返回 Hub]                    │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### 5.3 实现

```js
// src/ui/pages/agent-placeholder.js
import { getAgentMeta } from '../agent-registry.js';

export default {
  titleKey: 'page_agent_placeholder_title',

  async mount(outlet, { params }) {
    const meta = getAgentMeta(params.id);   // { name, colorToken, description }
    outlet.innerHTML = renderPlaceholder(meta);
  },

  unmount() {},
};
```

`agent-registry.js` 定义 8 个 Agent 的元数据（名称、描述、身份色、图标）。Hub 与占位页共用这个源。

---

## 6. Agent Registry（元数据权威清单）

`src/ui/agent-registry.js`（本迭代建立）：

```js
export const AGENTS = {
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    nameKey: 'agent_orchestrator',
    description: '总控大脑，管理 Campaign 生命周期',
    descriptionKey: 'agent_orchestrator_desc',
    color: 'var(--agent-orchestrator)',
    icon: 'network',
    layer: 'intelligence',
  },
  planner:      { /* ... */ layer: 'intelligence' },
  strategy:     { /* ... */ layer: 'execution' },
  'content-gen':{ /* ... */ layer: 'execution' },
  multimodal:   { /* ... */ layer: 'execution' },
  'channel-exec':{ /* ... */ layer: 'execution' },
  analysis:     { /* ... */ layer: 'feedback' },
  optimizer:    { /* ... */ layer: 'feedback' },
};
```

---

## 7. 验收清单（针对本迭代"占位页"）

- [ ] 8 个 Agent 路由均可访问
- [ ] 占位页正确显示 Agent 名 / 色块 / 描述
- [ ] 面包屑 Hub → Agents → {Name} 可点击
- [ ] "返回 Hub" 按钮跳回 `#/`
- [ ] Agent Registry 单一来源（Hub 和占位页读同一份）
