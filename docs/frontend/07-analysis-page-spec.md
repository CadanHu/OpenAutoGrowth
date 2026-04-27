# Analysis 页规格（Attribution 选择器） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-24 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

Analysis 页是**绩效报告与归因决策的合议台**：

1. 把最新一份 `ReportGenerated` 渲染成可读的指标 + 异常清单
2. 提供一个**客户端归因模型选择器**——用户可在 Last-touch / First-touch / Linear / Time-decay / Position-based 之间切换，立刻看到同一份原始数据按不同模型分摊到各渠道后的 ROAS / 收入差异

**它不是数据采集器**。Analysis 只读 `globalEventBus.history`，不直接调外部归因 API。归因模型在前端纯函数计算。

**路由**：`#/agents/analysis`
**模块**：`src/ui/pages/agent-analysis.js`
**i18n 标题**：`page_analysis_title` — "Analysis · 归因与报告"

---

## 2. 真实数据约束（实现前必读）

| 来源 | 字段 | v0.0.2 是否真实 |
| :--- | :--- | :--- |
| `ReportGenerated.payload.metrics` | impressions / clicks / spend / revenue / ctr / roas / cvr | ✅ 真实（前端 mock 或后端 stub，结构稳定） |
| `ReportGenerated.payload.anomalies` | metric / severity / description | ✅ 真实 |
| **per-channel 拆分** | spend/revenue × channel | 🚫 **后端无此数据**——v0.0.2 用确定性 hash 合成 |
| **触点序列**（attribution 真实算法所需） | session_id / channel / timestamp | 🚫 **后端无此数据**——v0.0.2 模型间差异通过权重系数差异化模拟 |

**结论**：Attribution Selector 在 v0.0.2 是**决策支持原型**——用户能感知"模型选择会改变 ROAS 判读"，但具体数字是合成的。v0.0.3 后端引入触点表后，本页 UI 不变，只换数据源。

---

## 3. 布局骨架

```
┌─ Breadcrumb / Header (frame 复用) ───────────────────────────┐
├─ Tabs: Overview | Attribution | Anomalies | Runs | Logs ───┤
├─ Tab Panel ─────────────────────────────────────────────────┤
│  [默认 Overview]                                              │
│  指标条 (impr / clicks / conv / spend / revenue / ROAS)       │
│  最近报告摘要卡片                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 区块规格

### 4.1 Tab: Overview

5 个 metric box + 摘要卡：
- Impressions / Clicks / Conversions / Spend / Revenue / ROAS / CTR
- 摘要：报告 ID、生成时间、关联 Campaign、异常数

### 4.2 Tab: Attribution（特化 — 主角）

**模型选择器**（顶部 segmented control）：
- `last_touch` — 100% 给最后一个渠道
- `first_touch` — 100% 给第一个渠道
- `linear` — 各渠道均分
- `time_decay` — 半衰期权重（最近 = 1.0，依次 ×0.5）
- `position_based` — 首末各 40%，中间均分 20%

**主表（channel × model 矩阵）**：

| Channel | Spend | Revenue (按当前模型) | ROAS | Δ vs Linear |
| :--- | :--- | :--- | :--- | :--- |
| TikTok | 12,000 | 28,500 | 2.38× | +0.3 |
| Meta   |  8,000 | 17,000 | 2.13× | -0.2 |
| ...    | ...    | ...    | ...  | ... |

底部说明：
> 渠道列表来自当前 Campaign 的 `constraints.channels`；revenue 拆分使用确定性 hash 合成（v0.0.3 接入后端真实触点数据后切换）。

### 4.3 Tab: Anomalies

异常列表：metric · severity · description · 触发时间。
顶部 chips：HIGH / MEDIUM / LOW 计数。
空态：`No anomalies detected` + 笑脸。

### 4.4 Tab: Runs

`ReportGenerated` 历史，行：时间 · 报告 id · ROAS · 异常数 · campaign 前缀。
点开展开完整 metrics JSON。

### 4.5 Tab: Logs

`ReportGenerated` + `AnomalyDetected` 两类事件，时间逆序。订阅事件，新事件实时插入。

---

## 5. 数据流

```js
// 挂载时
const latestReport = eventBus.history
  .filter(e => e.event_type === 'ReportGenerated')
  .at(-1);
const anomalies = eventBus.history.filter(e => e.event_type === 'AnomalyDetected');

// 订阅
const unsub1 = eventBus.subscribe('ReportGenerated', refresh);
const unsub2 = eventBus.subscribe('AnomalyDetected', refresh);
```

订阅范围 ✅ `ReportGenerated` `AnomalyDetected`
不订阅 ❌ `OptimizationApplied`（属于下游 Optimizer）

---

## 6. 归因算法（纯函数）

```js
function attribute(channels, totalRevenue, modelId) {
  switch (modelId) {
    case 'last_touch':     return [/* 0,0,...,total */];
    case 'first_touch':    return [/* total,0,... */];
    case 'linear':         return channels.map(_ => totalRevenue / channels.length);
    case 'time_decay':     // weights = [1, 0.5, 0.25, ...] normalized
    case 'position_based': // 0.4, 0.2/(n-2), ..., 0.4
  }
}
```

渠道顺序：按 Campaign `constraints.channels` 数组顺序（视为触点链）。仅 1 个渠道时所有模型退化为 100% 给该渠道。

---

## 7. 状态与边界

| 场景 | UI |
| :--- | :--- |
| 从未有 ReportGenerated | Overview 显示"暂无报告" + CTA "去 Hub 启动 Campaign" |
| 只有 1 个渠道 | Attribution 仍渲染但显示提示"单渠道下所有模型等价" |
| 异常数 = 0 | Anomalies tab 显示空态笑脸 |

---

## 8. 本迭代不做

| 项 | 延后到 |
| :--- | :--- |
| 真实触点数据驱动归因 | v0.0.3（后端 Touchpoint 表） |
| 模型对比（侧栏对照两种模型） | v0.0.3 |
| 自定义 time_decay 半衰期参数 | v0.2 |
| 报告导出 CSV / PDF | v0.2 |

---

## 9. 验收清单

- [ ] `#/agents/analysis` 命中专属页（非占位）
- [ ] Overview 渲染 ROAS / CTR / Spend / Revenue 等指标
- [ ] Attribution Tab 显示渠道 × 模型矩阵
- [ ] 切换模型后表格行数据立即变化（无网络请求）
- [ ] Anomalies Tab 列出异常，无异常时显示空态
- [ ] Runs Tab 可展开查看完整 metrics JSON
- [ ] zh/en 文案完整
- [ ] Tab 切换写 URL，回退恢复（依赖 Bug 1 修复）
