# Strategy 页规格（What-If 推演） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-25 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

Strategy 页让用户**安全预演策略变更**：改总预算 / 渠道组合 / 目标类型，立刻看到 `StrategyAgent` 输出的渠道分配与评分变化。

类似 Planner 的 Re-plan：纯前端预演，**不写回任何运行中的 Campaign**。

**路由**：`#/agents/strategy`
**模块**：`src/ui/pages/agent-strategy.js`
**i18n 标题**：`page_strategy_title` — "Strategy · 渠道与预算"

---

## 2. 数据形状（实现前必读）

### 2.1 真实事件 — `StrategyDecided`

```ts
{
  strategy: {
    channel_plan: [
      { channel, budget, score?, bid_strategy, bid_target?, ctr_baseline?, priority? }
    ],
    audience?: { type, age?, interests?, geo? },        // 仅前端版有
    schedule?: { timezone, peak_hours, pause_hours },   // 仅前端版有
    ab_split?: { variant_a, variant_b },                // 仅前端版有
    reasoning?: string,                                  // 仅后端 LLM 版有
    total_budget?: number,                               // 仅后端版有
    bid_rationale?: string,                              // 仅前端版有
  }
}
```

### 2.2 前后端两版的字段差

| 字段 | 前端 (`src/agents/Strategy.js`) | 后端 (`backend/app/agents/strategy.py`) |
| :--- | :---: | :---: |
| channel_plan | ✓ | ✓ |
| audience / schedule / ab_split | ✓ | ✗ |
| reasoning | ✗ | ✓（LLM 自然语言） |
| total_budget | ✗（隐式） | ✓ |

UI 必须**两种都能渲染**：缺字段时折叠对应 Card，不报错。

---

## 3. 布局骨架

```
┌─ Frame: Breadcrumb / Header / Tabs ─────────────────────────────┐
├ Tabs: Overview | Channel Plan | What-If | Runs | Logs ──────────┤
├ Tab Panel ──────────────────────────────────────────────────────┤
│  Overview: metric strip + reasoning card + audience/schedule    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 区块规格

### 4.1 Tab: Overview

- Metric Row：Total Budget · # Channels · Top Channel · ROAS Target（来自最新 StrategyDecided）
- Reasoning Card（仅当后端返回时展示）
- Audience / Schedule Card（仅当前端版返回时展示）

### 4.2 Tab: Channel Plan

完整 channel_plan 表：
| Channel | Budget | Score / Priority | Bid Strategy | Bid Target / CTR Baseline |

每行 channel 用 ChannelExec 身份色 pill。

### 4.3 Tab: What-If（特化 — 主角）

**左：表单**
- Goal Target：`cold_start | lookalike_audience | reach_maximize`
- Total Budget（数字）
- Channels（multi-select chips：tiktok / meta / google / wechat）
- KPI metric（ROAS / CTR / CPA）+ target

**右：实时预览**
- 表单任意改动 → 立刻调 `window.OAG.orchestrator.agents.get('Strategy').run({...})`
- 渲染输出：
  - 每渠道一张卡：channel pill + budget bar + score
  - 顶部 reasoning（如果有）
- 底部"Copy as JSON"按钮
- 顶部红字提示："预演模式 · 不会写入任何 Campaign"

**未来演进**："Apply to current campaign" 按钮 v0.0.3 上线，需要后端回调。

### 4.4 Tab: Runs

`StrategyDecided` 事件历史。展开看完整 strategy JSON。

### 4.5 Tab: Logs

只显示 `StrategyDecided` 事件流。订阅事件实时更新。

---

## 5. 数据流

```js
// 挂载时
const latest = eventBus.history.filter(e => e.event_type === 'StrategyDecided').at(-1);

// 订阅
const unsub = eventBus.subscribe('StrategyDecided', refresh);
```

订阅范围 ✅ `StrategyDecided`
不订阅 ❌ `ReportGenerated`（属于 Analysis）

---

## 6. 状态与边界

| 场景 | UI |
| :--- | :--- |
| 从未有 StrategyDecided | Overview 显示"暂无策略" + CTA "去 What-If 试一下" |
| 后端返回缺 audience/schedule | 折叠对应 Card，不留空架 |
| 前端返回缺 reasoning | 折叠 Reasoning Card |
| 用户在 What-If 选 0 渠道 | 表单按钮 disabled，显示 "至少选 1 个渠道" |

---

## 7. 本迭代不做

| 项 | 延后到 |
| :--- | :--- |
| What-If 结果写回当前 Campaign | v0.0.3（需后端回调） |
| 多策略并排对比（A/B/C） | v0.2 |
| 历史策略 diff（loop 1 vs loop 2） | v0.0.3 |
| 自定义渠道 baseline | v0.2（需配置存储） |

---

## 8. 验收清单

- [ ] `#/agents/strategy` 命中专属页（非占位）
- [ ] Overview 渲染最新策略指标
- [ ] Channel Plan 渲染完整表格
- [ ] What-If 表单改动立即重算预览
- [ ] What-If 不写入任何 Campaign（验证 eventBus.history 不增）
- [ ] Tab 进 URL，回退恢复
- [ ] zh/en 文案完整
