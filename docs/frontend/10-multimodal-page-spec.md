# Multimodal 页规格（素材库 & Playground） — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-26 | Owner: Frontend Team
> Status: Draft (SDD) — **v0.0.2 交付目标**

---

## 1. 页面定位

Multimodal 页让用户**浏览历次生成的素材，并即时试生成新素材**：

- 素材库网格：列出所有 Campaign 产出的图/视频卡，按尺寸/类型筛选
- Playground：调 `MultimodalAgent.run()`，输入 topic/style/brand colors → 即时看到 mock 输出（不写回 Campaign）
- 观察 `AssetsGenerated` 事件流

**不在范围内**：真实 CDN 渲染（URL 是 mock）、prompt 历史 diff、变体重生成、图片裁剪编辑器（→ v0.0.3+）。

**路由**：`#/agents/multimodal`
**模块**：`src/ui/pages/agent-multimodal.js`
**i18n 标题**：`page_multimodal_title` — "Multimodal · 素材库"

---

## 2. 数据形状

### 2.1 真实事件 — `AssetsGenerated`

```ts
{
  payload: { asset_ids: string[], type: 'image' | 'video' },
  campaign_id: string,
  occurred_at: ISOString,
}
```

> ⚠️ 事件 payload **不包含** asset 元数据（url / aspect_ratio / prompt）。
> 完整 asset 对象只在 `agent.run()` 返回值里——通过 Memory 间接拿到。

### 2.2 Memory（完整 asset 元数据来源）

`Orchestrator` 每次执行任务后调用 `memory.save(`${cid}:${task.id}`, result)`。
对 Multimodal，`result` 形如：

```ts
{
  agent: 'MULTIMODAL',
  assets: [
    { id, type:'IMAGE'|'VIDEO', url, thumbnail_url?, tool, aspect_ratio,
      width_px, height_px, duration_sec?, prompt, status:'GENERATED' }
  ],
  metadata: { tool, style, prompt, generated_at }
}
```

页面读法：

```js
const all = [];
for (const [key, entry] of memory.shortTerm.entries()) {
  const v = entry.value;
  if (v?.agent === 'MULTIMODAL' && Array.isArray(v.assets)) {
    all.push({ key, generatedAt: v.metadata?.generated_at, ...v });
  }
}
```

### 2.3 缩略图渲染策略

URL 指向 `https://cdn.openautogrowth.ai/...`（当前是 mock，会 404）。
Library / Playground 卡 **不发起网络请求**：用纯 SVG 占位（按 aspect_ratio 留出框 + 类型图标 + 比例文字）。
等 v0.0.3 接入真实 CDN 后再切换为 `<img>`。

---

## 3. 布局骨架

```
┌─ Frame: Breadcrumb / Header / Tabs ─────────────────────────────┐
├ Tabs: Overview | Library | Playground | Runs | Logs ────────────┤
├ Tab Panel ──────────────────────────────────────────────────────┤
│  Overview:    metric strip + 类型/尺寸分布 + 最近一次生成        │
│  Library:     筛选 chip + 网格卡片                              │
│  Playground:  表单（左）+ 结果网格（右），不写回 Campaign       │
│  Runs/Logs:   AssetsGenerated 事件                              │
└─────────────────────────────────────────────────────────────────┘
```

Header 右上角"Run"按钮 → 跳到 Playground tab（沿用 Strategy 模式）。

---

## 4. 区块规格

### 4.1 Overview

Metric Row：
- Total Assets（all `agent==='MULTIMODAL'` 的 asset 计数）
- Images / Videos（按 type）
- Aspect Ratios（去重计数）
- Last Generated（`metadata.generated_at` 最大值，`hh:mm:ss`）

Body：
- "Asset Distribution" panel-card：列出每个 aspect_ratio 的数量条
- "Last Generation" panel-card：缩略前 4 张

### 4.2 Library（特化 — 主角）

顶部 chip 筛选条：
- Type：All / Image / Video
- Aspect ratio：All / 1:1 / 9:16 / 16:9 / 4:5 / 4:3

网格：`.asset-grid` (auto-fit minmax(180px, 1fr))。每张卡：
- 占位图（按 aspect_ratio 渲染 SVG 占位 + type icon + ratio 文字）
- Footer：tool · width×height · duration（仅 video）
- 点击卡 → 展开 Drawer 显示完整 prompt + 全 metadata（JSON）

空态：`.dag-empty` 文案"No assets yet — Campaign 走到 Multimodal 后即在此显示。"

### 4.3 Playground（特化 — 沙箱）

仿照 Strategy What-If 布局：

**左：表单**
- Type：image / video（segmented）
- Topic（input）
- Style：minimalist / vibrant / professional（segmented）
- Brand colors（最多 2 个 color picker）
- Channels（multi-chip：tiktok / meta / google / wechat）
- Duration（仅 video，秒）

**右：结果**
- 调 `agent.run({ ...form, campaign_id: 'multimodal-preview' })`
- 渲染 `output.assets` 网格（同 Library 卡）
- 顶部红字 banner："Preview mode · 不会写入任何 Campaign"
- 底部 "Copy as JSON"

### 4.4 Runs

`AssetsGenerated` 事件历史。每行展开看 `payload.asset_ids` 列表。

### 4.5 Logs

实时事件流。

---

## 5. 数据流

```js
// Library / Overview 主数据源
const memoryEntries = memory.shortTerm;
// Runs / Logs / metric 计数辅助
const events = eventBus.history.filter(e => e.event_type === 'AssetsGenerated');
```

订阅 ✅ `AssetsGenerated`
不订阅 ❌ `ContentApproved` `AdDeployed`

Playground 调 `agent.run()` 会发 `AssetsGenerated` 并 publish；Memory 不会记录（Memory 只在 Orchestrator 路径下写入，不在直接调用时）——对 Library 透明。

---

## 6. 状态与边界

| 场景 | UI |
| :--- | :--- |
| Memory 无 MULTIMODAL 条目 | Library 空态 + Overview 显示 0 |
| Playground 选 `video` + 无 channels | 用 `['tiktok']` 默认（agent 内部已默认） |
| Playground topic 空 | 允许，agent 不强制（生成的 prompt 会带空 topic 段） |
| Memory 有但 `assets` 为 0 | 不计入 |

---

## 7. 本迭代不做

| 项 | 延后到 |
| :--- | :--- |
| 真实 CDN 缩略图加载 | v0.0.3（需 backend asset URL） |
| 重新生成单张资产 | v0.0.3 |
| Prompt 版本管理 / diff | v0.1 |
| 视频实际播放预览 | v0.1（需要 `.mp4` 真链） |
| 跨 Campaign 资产拼图 | v0.2 |

---

## 8. 验收清单

- [ ] `#/agents/multimodal` 命中专属页（非占位）
- [ ] 空态：Library 显示空态文案
- [ ] 注入 Multimodal memory 后：Library 渲染卡片，Overview 数字正确
- [ ] Playground 表单可运行，结果在右侧立刻渲染
- [ ] Playground 不写入 Campaign 真实资产（不影响 Library 统计）
- [ ] Tab 进 URL，回退恢复
- [ ] zh / en 文案完整
