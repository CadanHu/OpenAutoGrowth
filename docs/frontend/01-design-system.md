# 设计系统 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-22 | Owner: Frontend Team
> Status: Draft (SDD)

本文档定义前端视觉与交互的**原子规范**：色板、字体、间距、圆角、阴影、动效、图标。所有页面与组件必须基于这些 Token 构建；Token 定义见 `src/ui/tokens.css`。

---

## 1. 设计语言总则

> **关键词**：有机（Organic）· 宁静（Serene）· 高端（Premium）· 光滑（Smooth）· 温和（Gentle）

| 规则 | 做法 | 反例 |
| :--- | :--- | :--- |
| **分层靠深浅，不靠边框** | 多层米色背景叠出层级 | 粗黑边框、`rgba(255,255,255,0.1)` 冷玻璃边 |
| **阴影柔、暖、浅** | `rgba(139,115,85,0.08)` 棕调散射 | `rgba(0,0,0,0.5)` 黑色重阴影 |
| **圆角大而统一** | `20px / 28px` 两档主圆角 | 4px 方角或混用 6/10/14/18 |
| **对比度内敛** | 正文 `#2B2A26` on `#FDFBF6`（WCAG AA） | 纯黑 `#000` on 纯白 |
| **去 emoji 改线性 SVG** | 1.25px 描边、圆头、无填充 | 混用 emoji + flat icon |
| **动效慢而缓** | `280–420ms`，`cubic-bezier(0.22, 0.61, 0.36, 1)` | `150ms ease-out` 机械感 |

---

## 2. 色板（Color Palette）

### 2.1 背景分层（核心）

四档米色构成页面骨架，**严禁只用一种背景色**。

| Token | 色值 | 用途 |
| :--- | :--- | :--- |
| `--bg-L0` | `#FDFBF6` | 页面底层（最浅、最暖白） |
| `--bg-L1` | `#F8F3E9` | 卡片 / 面板 |
| `--bg-L2` | `#F5EEDC` | 嵌入式区域：输入框、代码块、feed 列表 |
| `--bg-L3` | `#EDE4CE` | 分隔栏 / Navbar / 选中态 hover 底色 |

**分层示意**：

```
 ┌─── L0 页面背景 #FDFBF6 ─────────────────┐
 │  ┌── L1 卡片 #F8F3E9 ─────────────┐    │
 │  │   ┌─ L2 输入框 #F5EEDC ──┐     │    │
 │  │   │                      │     │    │
 │  │   └──────────────────────┘     │    │
 │  └──────────────────────────────┘    │
 └──────────────────────────────────────┘
```

### 2.2 文字与边框

| Token | 色值 | 用途 |
| :--- | :--- | :--- |
| `--text-primary` | `#2B2A26` | 标题、主文字 |
| `--text-secondary` | `#6B655A` | 正文、说明 |
| `--text-tertiary` | `#A8A090` | 占位、时间戳 |
| `--text-inverse` | `#FDFBF6` | 深色按钮上的反白文字 |
| `--border-subtle` | `#EDE4CE` | 分隔线、卡片内部分割 |
| `--border-default` | `#E0D5BA` | 卡片/输入框默认边 |
| `--border-strong` | `#8B7355` | 焦点态、激活边 |

### 2.3 语义色

| Token | 色值 | 用途 |
| :--- | :--- | :--- |
| `--accent-primary` | `#8B7355` | 主按钮、激活、链接（焦糖棕） |
| `--accent-secondary` | `#A68A64` | hover、次级强调（金褐） |
| `--accent-soft` | `rgba(139,115,85,0.08)` | 激活背景 tint |
| `--success` | `#6B8E5A` | 成功、正向指标（橄榄绿） |
| `--warning` | `#C4894A` | 警告、优化触发（琥珀） |
| `--danger` | `#B04A3E` | 异常、删除（陶土红） |
| `--info` | `#5A7A8B` | 信息、中性提示（雾蓝灰） |

### 2.4 Agent 身份色（每个 Agent 独立识别色，用于头像/图标角）

| Agent | Token | 色值 |
| :--- | :--- | :--- |
| Orchestrator | `--agent-orchestrator` | `#8B7355` 焦糖棕（主色） |
| Planner | `--agent-planner` | `#7B8B5A` 橄榄绿 |
| Strategy | `--agent-strategy` | `#5A7A8B` 雾蓝灰 |
| ContentGen | `--agent-contentgen` | `#A68A64` 金褐 |
| Multimodal | `--agent-multimodal` | `#B5916B` 浅驼 |
| ChannelExec | `--agent-channelexec` | `#7A6B8B` 薰衣草紫 |
| Analysis | `--agent-analysis` | `#5A8B7B` 青瓷 |
| Optimizer | `--agent-optimizer` | `#C4894A` 琥珀 |

---

## 3. 字体（Typography）

### 3.1 字体族

```css
--font-serif:  'Fraunces', 'Noto Serif SC', Georgia, serif;     /* 标题 */
--font-sans:   'Inter', 'PingFang SC', 'Helvetica Neue', sans-serif; /* 正文 */
--font-mono:   'JetBrains Mono', 'SF Mono', Menlo, monospace;   /* 代码 / ID */
```

- Fraunces 是高端有机衬线，适合 Hero 和 Section 标题；
- Inter 是高可读性无衬线，用于正文、标签、按钮；
- 中文自动 fallback 到 `Noto Serif SC` / `PingFang SC`。

### 3.2 字号阶梯（Type Scale）

| Token | 字号 / 行高 | 用途 |
| :--- | :--- | :--- |
| `--fs-display` | `48px / 1.1` | Hero 主标题 |
| `--fs-h1` | `32px / 1.2` | 页面标题 |
| `--fs-h2` | `24px / 1.3` | Section 标题 |
| `--fs-h3` | `18px / 1.4` | 卡片标题 |
| `--fs-body` | `15px / 1.6` | 正文 |
| `--fs-sm` | `13px / 1.5` | 说明、标签 |
| `--fs-xs` | `11px / 1.4` | 时间戳、元数据 |

### 3.3 字重

- `--fw-regular: 400` 正文
- `--fw-medium: 500` 强调正文
- `--fw-semibold: 600` 副标题
- `--fw-bold: 700` 主标题（Fraunces 尤佳）

### 3.4 字距（Letter-spacing）

- 标题（Fraunces）：`-0.01em`（略紧）
- 正文：`0`（默认）
- 全大写标签：`0.08em`（拉开）

---

## 4. 间距（Spacing）

4px 基准的斐波那契微调：

| Token | 值 | 场景 |
| :--- | :--- | :--- |
| `--sp-1` | `4px` | 图标与文字间 |
| `--sp-2` | `8px` | 紧凑元素内部 |
| `--sp-3` | `12px` | 按钮内边距 |
| `--sp-4` | `16px` | 卡片内基础留白 |
| `--sp-5` | `24px` | Section 内块间距 |
| `--sp-6` | `32px` | 卡片间距 |
| `--sp-7` | `48px` | Section 之间 |
| `--sp-8` | `64px` | 页面大分段 |

---

## 5. 圆角（Radius）

| Token | 值 | 用途 |
| :--- | :--- | :--- |
| `--radius-sm` | `8px` | Tag、徽章 |
| `--radius-md` | `12px` | 按钮、输入框 |
| `--radius-lg` | `20px` | 卡片 |
| `--radius-xl` | `28px` | 大面板、Modal |
| `--radius-full` | `999px` | Pill、头像 |

---

## 6. 阴影（Shadow）

阴影一律为**暖棕散射**，避免黑色阴影。

| Token | 值 | 用途 |
| :--- | :--- | :--- |
| `--shadow-xs` | `0 1px 2px rgba(139,115,85,0.04)` | 按钮默认 |
| `--shadow-sm` | `0 2px 8px rgba(139,115,85,0.06)` | 卡片默认 |
| `--shadow-md` | `0 8px 24px rgba(139,115,85,0.08)` | 卡片 hover、浮层 |
| `--shadow-lg` | `0 16px 48px rgba(139,115,85,0.12)` | Modal |
| `--shadow-inset` | `inset 0 1px 2px rgba(139,115,85,0.06)` | 输入框嵌入感 |

---

## 7. 动效（Motion）

### 7.1 缓动曲线

```css
--ease-organic: cubic-bezier(0.22, 0.61, 0.36, 1);  /* 自然慢停 */
--ease-smooth:  cubic-bezier(0.4, 0, 0.2, 1);       /* Material 默认 */
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);  /* 弹性（轻用） */
```

### 7.2 时长

- `--dur-fast: 180ms` 颜色变化
- `--dur-base: 280ms` 位移、展开
- `--dur-slow: 420ms` 页面切换、大面板
- DAG 连线粒子流：`2.4s` 循环

---

## 8. 图标（Icons）

### 8.1 规则

- **线性 SVG，1.25px 描边，圆头（`stroke-linecap="round"`），无填充**
- 尺寸三档：`--icon-sm: 16px` / `--icon-md: 20px` / `--icon-lg: 24px`
- 颜色 `currentColor`，由父元素 `color` 决定
- 禁止 emoji（含当前代码里的 🚀🎨📡📊⚙️ 等）

### 8.2 Agent 图标映射

| Agent | 图标语义 | 取自 Lucide 对应物 |
| :--- | :--- | :--- |
| Orchestrator | 中枢 / 网络 | `network` |
| Planner | 地图 / 路径 | `map` |
| Strategy | 趋势 | `trending-up` |
| ContentGen | 文本 / 编辑 | `pen-line` |
| Multimodal | 画布 / 图像 | `image` |
| ChannelExec | 信号塔 | `radio-tower` |
| Analysis | 图表 | `bar-chart-3` |
| Optimizer | 齿轮 / 优化 | `settings-2` |

图标集内联在 `src/ui/icons.js`，以 `icon(name, size)` 工厂函数导出。

---

## 9. 组件样式规范

### 9.1 卡片（Card）

```
background:   var(--bg-L1)
border:       1px solid var(--border-subtle)
border-radius:var(--radius-lg)
padding:      var(--sp-5)
shadow:       var(--shadow-sm)
hover:        transform: translateY(-2px); shadow: var(--shadow-md);
```

### 9.2 按钮（Button）

**Primary**（主按钮）
- 背景 `--accent-primary`，文字 `--text-inverse`
- 圆角 `--radius-md`，内边距 `12px 20px`
- hover：背景深 6%（`#7D6649`），阴影 `--shadow-md`

**Secondary**（次按钮）
- 背景 `--bg-L2`，文字 `--text-primary`
- 边框 `1px solid --border-default`
- hover：背景 `--bg-L3`

**Ghost**（幽灵按钮）
- 透明背景，文字 `--text-secondary`
- hover：背景 `--accent-soft`

### 9.3 输入框（Input / Textarea）

- 背景 `--bg-L2`
- 边框 `1px solid --border-default`
- 圆角 `--radius-md`，内边距 `12px 16px`
- focus：边 `--border-strong`，阴影 `0 0 0 3px rgba(139,115,85,0.12)`

### 9.4 标签 / 徽章（Tag / Badge）

- 背景 `--accent-soft`，文字 `--accent-primary`
- 圆角 `--radius-full`
- 字号 `--fs-xs`，内边距 `4px 10px`，字母全大写 + letter-spacing `0.08em`

---

## 10. 可访问性（A11y）

- 所有文字组合必须通过 WCAG AA（4.5:1）
- 焦点环：`outline: 2px solid var(--accent-primary); outline-offset: 2px`（不要移除）
- `prefers-reduced-motion`: 动效时长降为 0ms
- 所有按钮/链接有语义化 label 或 `aria-label`
- 颜色之外必须有第二信号（图标或文字）区分状态

---

## 11. Token 总清单（供 `tokens.css` 落地）

见实现文件 `src/ui/tokens.css`。所有组件 CSS 只能引用 Token，不得写死色值。
