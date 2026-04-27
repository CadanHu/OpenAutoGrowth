# Campaigns 页规格（活动列表与详情） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-27 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

Campaigns 模块包含两个页面：
1. **活动列表页 (`/campaigns`)**：集中展示所有 Campaign 的概览信息。
2. **活动详情页 (`/campaigns/:id`)**：展示单个 Campaign 的详细状态流转、目标、指标以及关联的 Task。

**依赖数据源**：
- `window.OAG.orchestrator.campaigns` (Map)

---

## 2. 列表页 (`/campaigns`)

### 2.1 布局与内容
- **页面标题**：Campaigns (Review past campaigns and performance)
- **主区域**：展示 Campaign 表格（如果没有则显示 empty state）。
- **表格字段**：
  - `Campaign ID` (链接，点击跳转详情页 `#/campaigns/:id`)
  - `Name` (目标)
  - `Status` (状态标签)
  - `Budget` (预算，格式化货币)
  - `KPI` (指标类型与目标，如 ROAS 3.0)
  - `Loops` (循环次数)

---

## 3. 详情页 (`/campaigns/:id`)

### 3.1 布局与内容
- **顶部面包屑**：Hub > Campaigns > `{campaign_id}`
- **Header**：
  - Campaign ID 及状态标签。
  - 名称 (Name)。
- **指标卡片 (Metric Strip)**：
  - `Status`: 当前状态
  - `Budget`: 总预算
  - `KPI`: KPI 目标
  - `Loops`: 循环次数
- **Tasks 列表**：
  - 展示该 Campaign 下的 Active Tasks（`campaign.active_tasks`，如果有的话）。
  - 如果可以关联到 Memory 中的历史数据也可以展示，但在 v0.0.2 简化为只展示任务 ID。

---

## 4. 测试用例 (Smoke Tests)
1. Campaigns: 访问 `/campaigns`，当无数据时显示 empty state。
2. Campaigns: 启动任务后，列表中出现对应的 Campaign 且能点击进入详情页。
3. Campaign Detail: 在详情页中渲染基本信息与状态。
