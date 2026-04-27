# ChannelExec 页规格（凭据 & 部署观察） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-26 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

ChannelExec 页让用户**集中管理多渠道接入并观察部署链路**：

- 看到每条渠道（TikTok / Meta / Google / 微信）当前接入状态、Adapter 类型、最近一次连通测试结果
- 在 sandbox 环境下"试探一下"——不需要真实凭据，触发 mock adapter 验证整条调用链
- 浏览历史 `AdDeployed` 事件（campaign / 平台 / 广告 ID）

**不在范围内**：真实密钥落库 / OAuth 授权 / 凭据轮换 / 平台健康监控（→ v0.0.3）。

**路由**：`#/agents/channel-exec`
**模块**：`src/ui/pages/agent-channel-exec.js`
**i18n 标题**：`page_channelexec_title` — "ChannelExec · 渠道接入与部署"

---

## 2. 数据形状

### 2.1 真实事件 — `AdDeployed`

来自 `src/agents/ChannelExec.js` 的 publish：

```ts
{
  payload: {
    ad_campaign_ids: string[],   // 每平台一个
    platforms:       string[],   // 与 ad_campaign_ids 同序
  },
  campaign_id: string,
  occurred_at: ISOString,
}
```

ChannelExec 还在 `agent.run()` 返回值里给出更细的 `ad_campaigns[].ad_ids`，但**事件流里没有**——这一层细节在本页不可见，避免造假。

### 2.2 渠道清单

来自 `agent.adapters` 的 keys（运行时真值）：当前是 `tiktok / meta / google`。
另外补充常见但尚未接入的渠道（`wechat`），统一展示为 `not configured` 状态。

### 2.3 凭据状态（v0.0.2：仅前端）

> ⚠️ **v0.0.2 实现说明**：本页凭据仅落 `localStorage`，**不会**发送到后端、**不会**用于真实 API 调用。
> Adapter 仍是 `MockAdsAdapter`。本页的存在是为了在 v0.0.3 接入真正 secret store 之前先收敛交互形态。

`localStorage` key：`oag.channel-exec.credentials.v1`

```ts
{
  [channel: string]: {
    env: 'sandbox' | 'prod',
    alias: string,                  // 用户起的名字，例如 "Brand main"，纯展示
    last_tested_at: ISOString | null,
    last_test_ok: boolean | null,
  }
}
```

### 2.4 状态色阶

| 状态 | 触发条件 | 颜色（CSS token） |
| :--- | :--- | :--- |
| connected | adapter 存在 ∧ alias 非空 ∧ last_test_ok === true | --success |
| sandbox   | adapter 存在 ∧ alias === ''（默认） | --agent-channelexec |
| untested  | adapter 存在 ∧ alias 非空 ∧ last_tested_at === null | --text-tertiary |
| error     | adapter 存在 ∧ last_test_ok === false | --danger |
| missing   | adapter 不存在（如 wechat） | --border-medium |

---

## 3. 布局骨架

```
┌─ Frame: Breadcrumb / Header / Tabs ─────────────────────────────┐
├ Tabs: Overview | Credentials | Deploys | Logs ──────────────────┤
├ Tab Panel ──────────────────────────────────────────────────────┤
│  Overview:    metric strip + 状态汇总 + 最近一次部署            │
│  Credentials: per-channel 卡（status pill + alias + test btn）  │
│  Deploys:     AdDeployed 事件表，按时间倒序                     │
│  Logs:        AdDeployed 事件流（实时订阅）                     │
└─────────────────────────────────────────────────────────────────┘
```

Header 右上角的"Run"按钮**不出现**——单页无法独立触发部署（需要上下文 `context.t1/t2/t3`）。改为渲染 sandbox 状态徽章（"Sandbox · MockAdsAdapter"）。

---

## 4. 区块规格

### 4.1 Tab: Overview

Metric Row：
- Channels Configured（adapter 存在的数量）
- Channels Connected（status === connected 的数量）
- Total Deploys（`AdDeployed` 事件总数）
- Last Deploy（最近事件的 `occurred_at`，`hh:mm:ss`）

Body：
- "Last Deploy" panel-card：展示最近一次事件的 platforms + ad_campaign_ids（裁短）
- 顶部 Sandbox banner：复用 `.replan-banner` 样式，措辞"Mock adapter mode · 真实部署在 v0.0.3 接入"

### 4.2 Tab: Credentials（特化 — 主角）

`.cred-grid`：每渠道一张卡（约 320px 宽，2 列网格）：

- 卡头：channel-pill + status-pill（带 dot 颜色）
- 卡身（kv-grid）：
  - Adapter（如 `MockAdsAdapter`，或 `—` 当 missing）
  - Env（select：sandbox / prod；missing 时锁住）
  - Alias（input，可编辑；blur 时落 storage）
  - Last tested（fmtTime；null → `—`）
- 卡脚：
  - "Test connection" 按钮（missing 时禁用）
  - "Reset" 按钮（清掉 alias / last_*）
- 测试 ⇒ 调 `agent.adapters[ch].createCampaign({ budget: 1 })`，成功更新 `last_test_ok=true`，失败 `false`，捕获异常文案展示在卡内。

### 4.3 Tab: Deploys

`.attr-table`（复用样式）：
| Time | Campaign | Platforms | Ad Campaign IDs |

每行可点击展开，展开区域显示完整 payload JSON。复用 `.run-row` 模式。

### 4.4 Tab: Logs

复用 `.logs-view`：实时订阅 `AdDeployed`，每条一行：
`time | AdDeployed | <platforms.join(', ')> · <campaign_id 前 8 位>…`

---

## 5. 数据流

```js
// 挂载时
const events = eventBus.history.filter(e => e.event_type === 'AdDeployed');

// 订阅（Overview / Deploys / Logs 三个 tab 共用一个工厂）
const unsub = eventBus.subscribe('AdDeployed', refresh);
```

订阅范围 ✅ `AdDeployed`
不订阅 ❌ `StrategyDecided` `ContentApproved`（属于 Strategy / ContentGen / Reviewer）

凭据读写仅命中 `localStorage`，无网络。

---

## 6. 状态与边界

| 场景 | UI |
| :--- | :--- |
| 从未有 AdDeployed | Overview / Deploys / Logs 显示空态文案，Credentials 仍可正常配置和测试 |
| Adapter 缺失（wechat） | 卡片状态 `missing`，按钮禁用，提示"No adapter wired" |
| Test 抛异常 | 状态置 `error`，按钮下方红字显示 `err.message` |
| localStorage 不可写（隐私模式） | catch 静默，状态停留在内存，刷新后丢失（Banner 提示一次） |

---

## 7. 本迭代不做

| 项 | 延后到 |
| :--- | :--- |
| 真实凭据写入 secret store + 后端调用 | v0.0.3（需 secret storage 设计 + KMS） |
| OAuth 授权流（Meta / Google） | v0.0.3 |
| 凭据轮换 / 过期提醒 | v0.1 |
| 渠道健康仪表盘（rate limit / 拒投率） | v0.2（需 Analysis 联动） |
| 从本页直接重投某 ad campaign | v0.0.3（需要后端回调） |

---

## 8. 验收清单

- [ ] `#/agents/channel-exec` 命中专属页（非占位）
- [ ] Overview 显示渠道数、Connected 数、总部署数、最近部署时间
- [ ] Credentials 渲染 4 张卡（tiktok / meta / google / wechat）
- [ ] Test connection 在前 3 张卡上成功，wechat 卡按钮禁用
- [ ] Deploys 表格在事件存在时渲染
- [ ] Tab 进 URL，回退恢复
- [ ] Sandbox banner 一直显示
- [ ] zh / en 文案完整
