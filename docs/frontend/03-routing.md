# 路由机制 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-22 | Owner: Frontend Team
> Status: Draft (SDD)

---

## 1. 目标

为前端提供一个**零依赖、静态托管友好、可平滑升级**的路由机制，承载：

1. Hub 与 9 个 Agent 页面 / 活动历史页的切换；
2. 深链分享（`#/agents/optimizer?campaign=xxx`）；
3. 浏览器后退/前进按钮。

---

## 2. 路由协议

### 2.1 Hash 路由

所有路由以 `#/` 为前缀，使用 `location.hash`：

| URL | 含义 |
| :--- | :--- |
| `https://host/` → 等价 `#/` | Hub |
| `https://host/#/agents/content-gen` | 打开 ContentGen Agent 页 |
| `https://host/#/agents/optimizer?campaign=c_123` | 打开 Optimizer 并传参 |
| `https://host/#/campaigns` | 活动历史列表 |

### 2.2 路径解析

```
#/<segment>/<segment>?<query>
   │         │          │
   │         │          └─ URLSearchParams
   │         └──────────── path params
   └────────────────────── path
```

路由表规则：
- 静态匹配优先（`/agents/content-gen`）
- 动态段使用 `:param` 占位（`/campaigns/:id`）
- 无匹配 → redirect `#/`

---

## 3. Router API

### 3.1 注册路由

```js
import { router } from './ui/router.js';

router.register('/', () => import('./ui/pages/hub.js'));
router.register('/agents/content-gen', () => import('./ui/pages/agent-content-gen.js'));
router.register('/agents/:id', () => import('./ui/pages/agent-placeholder.js'));
router.register('/campaigns', () => import('./ui/pages/campaigns.js'));

router.setFallback('/');
router.start();
```

### 3.2 Page 模块契约

每个页面模块必须 `default export` 一个对象：

```js
export default {
  /**
   * 挂载页面
   * @param {HTMLElement} outlet - 容器元素
   * @param {{ params: object, query: object }} ctx
   * @returns {Promise<void>|void}
   */
  async mount(outlet, ctx) { ... },

  /**
   * 卸载（清理订阅、定时器、事件监听）
   */
  unmount() { ... },

  /**
   * i18n 标题 key（用于 document.title）
   */
  titleKey: 'page_hub_title',
};
```

### 3.3 生命周期

```
URL change → match route
         → prev.unmount()
         → import page module (lazy)
         → outlet.innerHTML = ''   // 清空
         → page.mount(outlet, ctx)
         → document.title = i18n.t(titleKey)
         → focus outlet <h1>       // A11y
```

### 3.4 跨页面导航

```js
router.navigate('/agents/optimizer');                    // 纯跳
router.navigate('/agents/optimizer', { campaign: 'c_1' }); // 带 query
router.back();                                            // 后退
```

组件内也可以直接用 `<a href="#/agents/optimizer">`，浏览器原生触发 `hashchange`。

---

## 4. 实现规范（`src/ui/router.js`）

```js
// 伪代码骨架
class HashRouter {
  constructor() {
    this.routes = [];        // [{ pattern, loader, keys }]
    this.fallback = '/';
    this.current = null;     // { path, page, cleanup }
  }

  register(pattern, loader) {
    const keys = [];
    const regex = patternToRegex(pattern, keys); // /agents/:id → /^\/agents\/([^/]+)$/
    this.routes.push({ pattern, regex, keys, loader });
  }

  setFallback(path) { this.fallback = path; }

  start() {
    window.addEventListener('hashchange', () => this._resolve());
    this._resolve();
  }

  navigate(path, query) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    location.hash = '#' + path + qs;
  }

  async _resolve() {
    const hash = location.hash.slice(1) || '/';
    const [path, queryStr] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryStr));

    const match = this._match(path);
    if (!match) return this.navigate(this.fallback);

    // Teardown previous
    if (this.current?.page?.unmount) {
      try { this.current.page.unmount(); } catch (e) { console.error(e); }
    }

    // Load module (code-split)
    const module = await match.route.loader();
    const page = module.default;

    const outlet = document.getElementById('app-outlet');
    outlet.innerHTML = '';
    await page.mount(outlet, { params: match.params, query });

    // A11y
    document.title = i18n.t(page.titleKey) + ' — OpenAutoGrowth';
    outlet.querySelector('h1')?.focus();

    this.current = { path, page };
  }

  _match(path) {
    for (const route of this.routes) {
      const m = path.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
        return { route, params };
      }
    }
    return null;
  }
}

export const router = new HashRouter();
```

---

## 5. AppShell 约定

`index.html` 精简为 **Shell**，只保留：

```html
<body>
  <div id="app">
    <nav id="app-navbar"></nav>       <!-- 由 shell.js 渲染 -->
    <main id="app-outlet"></main>     <!-- Router 注入页面 -->
    <footer id="app-footer"></footer>
  </div>
  <script type="module" src="/main.js"></script>
</body>
```

所有 Modal（Launch / History / Article）继续挂在 `body` 尾部，由各页面按需显示，不随路由切换销毁。

---

## 6. 与现有代码的衔接

| 现有 | 迁移后 |
| :--- | :--- |
| `DashboardController` 单例 | 拆成 `AppShell` + 各 `Page` |
| 所有 DOM 操作集中在 `main.js` | 分散到 `ui/pages/*.js`，Shell 只管 Navbar/Footer/Router |
| 事件订阅在构造函数里 | 每个 Page 在 `mount` 订阅、`unmount` 取消 |
| 模态框 DOM 嵌在 `index.html` | 保留（全局模态）；后续按需拆出 `ui/modals/*.js` |

---

## 7. 渐进式升级路径

| 阶段 | 说明 |
| :--- | :--- |
| **v0.1** | Hub 已实现，其它路由命中占位页 |
| **v0.2** | 逐个落地 Agent 页（先 ContentGen、Optimizer） |
| **v0.3** | 深链参数完整打通 |
| **v1.0** | 切换到 History API（如需更干净 URL），Router 接口不变 |

---

## 8. 性能与错误处理

- **懒加载**：`loader` 是 `() => import(...)`，页面按需加载；
- **加载态**：router 在 `_resolve` 期间向 outlet 插入骨架屏（`<div class="route-skeleton"/>`）；
- **加载失败**：`try/catch` 捕获 `import` 错误，渲染错误面板并提供"重试"按钮；
- **卸载异常隔离**：`unmount` 抛错不阻断后续流程。

---

## 9. 测试要点

- 直接访问 `#/agents/optimizer` 首屏就能渲染正确页面；
- 浏览器后退/前进按钮行为正确；
- 路由切换时上一页的订阅已清理（无重复日志）；
- 未知路由正确回退到 Hub。
