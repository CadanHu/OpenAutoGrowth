/*
 * Agent Page Frame — shared skeleton for per-agent workbenches.
 * See: docs/frontend/05-agent-page-template.md §2
 *
 * Usage:
 *   const frame = createAgentFrame({
 *     agent: AGENTS['content-gen'],
 *     tabs: [
 *       { id: 'overview',   labelKey: 'agent_tab_overview',   render: renderOverview },
 *       ...
 *     ],
 *     onRun?: () => { ... },         // Header "Run" button handler (optional)
 *   });
 *   frame.mount(outlet);             // renders breadcrumb + header + tab bar + panel
 *   frame.unmount();                 // detaches listeners
 */

import { i18n }   from '../../i18n/index.js';
import { icon }   from '../icons.js';
import { router } from '../router.js';

export function createAgentFrame({ agent, tabs, onRun }) {
  let root = null;
  let panelEl = null;
  let currentTabId = tabs[0]?.id;
  let currentCleanup = null;
  const tabListeners = [];

  function t(key, fallback) { return i18n.t(key) || fallback; }

  function renderSkeleton() {
    return `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/">${t('nav_hub', 'Hub')}</a>
        ${icon('chevron-right', 'sm')}
        <span>${t('nav_agents', 'Agents')}</span>
        ${icon('chevron-right', 'sm')}
        <span class="breadcrumb-current">${agent.name}</span>
      </nav>

      <header class="agent-header" style="--agent-color:${agent.color}">
        <div class="agent-header-id">
          <span class="agent-header-icon">${icon(agent.icon, 'lg')}</span>
          <div class="agent-header-text">
            <h1 tabindex="-1">${agent.name}</h1>
            <p>${t(agent.descriptionKey, agent.description)}</p>
          </div>
        </div>
        <div class="agent-header-actions">
          <span class="status-pill" data-agent-status>
            <span class="dot" style="background:${agent.color}"></span>
            <span data-agent-status-label>${t('metric_idle', 'Idle')}</span>
          </span>
          ${onRun ? `
            <button class="btn btn-primary" data-agent-run>
              ${icon('play', 'sm')}
              <span>${t('btn_run_now', 'Run Now')}</span>
            </button>` : ''}
        </div>
      </header>

      <nav class="agent-tabs" role="tablist" aria-label="${agent.name} sections">
        ${tabs.map(tab => `
          <button class="agent-tab ${tab.id === currentTabId ? 'active' : ''}"
                  role="tab"
                  data-tab="${tab.id}"
                  aria-selected="${tab.id === currentTabId}">
            ${tab.icon ? icon(tab.icon, 'sm') : ''}
            <span>${t(tab.labelKey, tab.label || tab.id)}</span>
          </button>
        `).join('')}
      </nav>

      <section class="agent-tab-panel" role="tabpanel" data-agent-panel></section>
    `;
  }

  async function renderTab(id) {
    if (!panelEl) return;
    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch (e) { console.error('[agent-frame] tab cleanup error', e); }
      currentCleanup = null;
    }
    currentTabId = id;
    const tab = tabs.find(t => t.id === id);
    if (!tab) { panelEl.innerHTML = ''; return; }

    panelEl.innerHTML = `<div class="tab-loading"><span class="dot pulse"></span></div>`;
    try {
      const res = await tab.render(panelEl, { agent, setStatus });
      if (typeof res === 'function') currentCleanup = res;
    } catch (e) {
      console.error('[agent-frame] tab render error', e);
      panelEl.innerHTML = `<div class="tab-error">${e.message}</div>`;
    }

    root.querySelectorAll('.agent-tab').forEach(btn => {
      const active = btn.dataset.tab === id;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function setStatus(label, tone) {
    const el = root?.querySelector('[data-agent-status-label]');
    if (el) el.textContent = label;
    const badge = root?.querySelector('[data-agent-status]');
    if (badge) badge.dataset.tone = tone || 'idle';
  }

  function mount(outletOrEl) {
    root = outletOrEl;
    root.innerHTML = renderSkeleton();
    panelEl = root.querySelector('[data-agent-panel]');

    root.querySelectorAll('.agent-tab').forEach(btn => {
      const handler = () => renderTab(btn.dataset.tab);
      btn.addEventListener('click', handler);
      tabListeners.push({ btn, handler });
    });

    if (onRun) {
      const btn = root.querySelector('[data-agent-run]');
      const handler = () => onRun({ setStatus });
      btn?.addEventListener('click', handler);
      tabListeners.push({ btn, handler });
    }

    renderTab(currentTabId);
  }

  function unmount() {
    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch {}
      currentCleanup = null;
    }
    tabListeners.forEach(({ btn, handler }) => btn?.removeEventListener('click', handler));
    tabListeners.length = 0;
    root = null;
    panelEl = null;
  }

  return { mount, unmount, renderTab, setStatus, navigateHub: () => router.navigate('/') };
}
