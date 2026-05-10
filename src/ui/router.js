/*
 * Hash Router — zero-dependency client-side routing.
 * See: docs/frontend/03-routing.md
 *
 * Contract: every Page module default-exports:
 *   { titleKey: string, mount(outlet, ctx): void|Promise, unmount?(): void }
 */

import { i18n } from '../i18n/index.js';

function patternToRegex(pattern, keys) {
  const escaped = pattern
    .replace(/[.+*?^$()[\]{}|\\]/g, '\\$&')
    .replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
      keys.push(k);
      return '/([^/]+)';
    });
  return new RegExp('^' + escaped + '$');
}

class HashRouter {
  constructor() {
    this.routes = [];
    this.fallback = '/';
    this.current = null;
    this.outlet = null;
    this._onHashChange = this._resolve.bind(this);
    // Page bodies render text via i18n.t() at mount time and never re-translate.
    // When the user toggles locale, re-mount the current route so the new
    // language paints everywhere — not just the navbar/footer that subscribe.
    this._onLanguageChanged = this._resolve.bind(this);
  }

  setOutlet(el) { this.outlet = el; }

  register(pattern, loader) {
    const keys = [];
    const regex = patternToRegex(pattern, keys);
    this.routes.push({ pattern, regex, keys, loader });
    return this;
  }

  setFallback(path) { this.fallback = path; return this; }

  start() {
    window.addEventListener('hashchange', this._onHashChange);
    document.addEventListener('languageChanged', this._onLanguageChanged);
    this._resolve();
  }

  stop() {
    window.removeEventListener('hashchange', this._onHashChange);
    document.removeEventListener('languageChanged', this._onLanguageChanged);
  }

  navigate(path, query) {
    const qs = query && Object.keys(query).length
      ? '?' + new URLSearchParams(query).toString()
      : '';
    const next = '#' + path + qs;
    if (location.hash === next) {
      this._resolve();
    } else {
      location.hash = next;
    }
  }

  current_path() {
    const hash = location.hash.slice(1) || '/';
    return hash.split('?')[0];
  }

  // Read the current URL query as a plain object. Pages should call this
  // instead of caching values at mount time, so query updates from
  // setQuery() are picked up.
  getQuery() {
    const hash = location.hash.slice(1) || '/';
    const queryStr = hash.split('?')[1] || '';
    return Object.fromEntries(new URLSearchParams(queryStr));
  }

  // Mutate the current URL's query string in place without re-resolving the
  // route. `updates` is an object: keys with `null`/`undefined` are removed,
  // other values are coerced to strings.
  //
  // Uses replaceState by default — typical UI selections (active campaign,
  // active tab) shouldn't pollute the history stack. Pass `{ push: true }`
  // for actions that *should* be back-button-undoable.
  //
  // Dispatches a `queryChanged` CustomEvent on document so listening pages
  // can repaint affected tabs without a full re-mount.
  setQuery(updates, { push = false } = {}) {
    const hash = location.hash.slice(1) || '/';
    const [path, queryStr] = hash.split('?');
    const params = new URLSearchParams(queryStr || '');
    let changed = false;
    for (const [k, v] of Object.entries(updates || {})) {
      if (v == null || v === '') {
        if (params.has(k)) { params.delete(k); changed = true; }
      } else {
        const next = String(v);
        if (params.get(k) !== next) { params.set(k, next); changed = true; }
      }
    }
    if (!changed) return;
    const qs = params.toString();
    const next = '#' + path + (qs ? '?' + qs : '');
    try {
      if (push) history.pushState(null, '', next);
      else      history.replaceState(null, '', next);
    } catch (e) {
      // Some browsers reject too-frequent replaceState; fall back to direct
      // hash assignment, which DOES fire hashchange and re-resolve. That's
      // a minor UX cost but keeps the URL truthful.
      console.warn('[router] setQuery failed, falling back to hash assignment', e);
      location.hash = next.slice(1);
      return;
    }
    const query = Object.fromEntries(params);
    if (this.current) this.current.query = query;
    document.dispatchEvent(new CustomEvent('queryChanged', { detail: { path, query } }));
  }

  _match(path) {
    for (const route of this.routes) {
      const m = path.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
    }
    return null;
  }

  async _resolve() {
    if (!this.outlet) return;

    const hash = location.hash.slice(1) || '/';
    const [path, queryStr] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryStr || ''));

    const hit = this._match(path);
    if (!hit) {
      this.navigate(this.fallback);
      return;
    }

    if (this.current?.page?.unmount) {
      try { await this.current.page.unmount(); }
      catch (e) { console.error('[router] unmount error', e); }
    }

    this.outlet.innerHTML = '<div class="route-skeleton" aria-busy="true"></div>';

    let pageModule;
    try {
      pageModule = await hit.route.loader();
    } catch (e) {
      console.error('[router] loader failed', e);
      this.outlet.innerHTML = `
        <div class="route-error">
          <h1>加载失败 / Load failed</h1>
          <p>${e.message}</p>
          <button onclick="location.reload()">重试 / Retry</button>
        </div>`;
      return;
    }

    const page = pageModule.default;
    this.outlet.innerHTML = '';
    try {
      await page.mount(this.outlet, { params: hit.params, query });
    } catch (e) {
      console.error('[router] mount error', e);
      this.outlet.innerHTML = `<div class="route-error"><h1>Error</h1><p>${e.message}</p></div>`;
      return;
    }

    if (page.titleKey) {
      document.title = `${i18n.t(page.titleKey)} — OpenAutoGrowth`;
    }
    const h1 = this.outlet.querySelector('h1');
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      try { h1.focus({ preventScroll: true }); } catch {}
    }

    this.current = { path, page, query };
    document.body.dataset.route = path;

    document.dispatchEvent(new CustomEvent('routeChanged', {
      detail: { path, query, params: hit.params },
    }));
  }
}

export const router = new HashRouter();
