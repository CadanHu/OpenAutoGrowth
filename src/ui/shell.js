/*
 * AppShell — renders the persistent Navbar (logo / nav links / lang / status)
 * and Footer. Each route's content lives in #app-outlet.
 *
 * See: docs/frontend/02-information-architecture.md §4, §6
 */

import { i18n } from '../i18n/index.js';
import { icon } from './icons.js';
import { router } from './router.js';
import { AGENTS, AGENT_ORDER, LAYER_LABELS, listAgentsByLayer } from './agent-registry.js';

export class AppShell {
  constructor() {
    this._closeAgentsMenu = this._closeAgentsMenu.bind(this);
    this._agentsMenuOpen = false;
  }

  mount() {
    this._renderNavbar();
    this._renderFooter();
    this._bindNav();
    this._bindLang();
    this._bindPauseAll();
    this._highlightCurrent(router.current_path());

    document.addEventListener('routeChanged', (e) => {
      this._highlightCurrent(e.detail.path);
      this._closeAgentsMenu();
    });

    document.addEventListener('languageChanged', () => {
      this._renderNavbar();
      this._renderFooter();
      this._bindNav();
      this._bindLang();
      this._bindPauseAll();
      this._highlightCurrent(router.current_path());
    });
  }

  _renderNavbar() {
    const navbar = document.getElementById('app-navbar');
    if (!navbar) return;

    const groups = listAgentsByLayer();
    const locale = i18n.locale;

    const groupBlock = (layer, items) => `
      <div class="menu-group">
        <div class="menu-group-title">${LAYER_LABELS[layer][locale] || LAYER_LABELS[layer].en}</div>
        ${items.map(a => `
          <a class="menu-item" href="#/agents/${a.id}" data-route="/agents/${a.id}">
            <span class="menu-item-dot" style="background:${a.color}"></span>
            <span class="menu-item-name">${a.name}</span>
          </a>
        `).join('')}
      </div>`;

    navbar.innerHTML = `
      <div class="nav-inner">
        <a class="brand" href="#/" aria-label="OpenAutoGrowth Home">
          <span class="brand-mark">${icon('sprout', 'md')}</span>
          <span class="brand-name">OpenAutoGrowth</span>
        </a>

        <nav class="nav-links" aria-label="Primary">
          <a class="nav-link" href="#/" data-route="/">${i18n.t('nav_hub') || 'Hub'}</a>
          <div class="nav-dropdown" id="nav-agents-wrap">
            <button class="nav-link nav-dropdown-trigger" id="nav-agents-btn" aria-haspopup="true" aria-expanded="false">
              ${i18n.t('nav_agents') || 'Agents'}
              ${icon('chevron-down', 'sm')}
            </button>
            <div class="nav-menu" id="nav-agents-menu" role="menu">
              ${groupBlock('intelligence', groups.intelligence)}
              ${groupBlock('execution',    groups.execution)}
              ${groupBlock('feedback',     groups.feedback)}
            </div>
          </div>
          <a class="nav-link" href="#/campaigns" data-route="/campaigns">${i18n.t('nav_campaigns') || 'Campaigns'}</a>
          <a class="nav-link" href="#/integrations" data-route="/integrations">${i18n.t('nav_integrations') || 'Integrations'}</a>
        </nav>

        <div class="nav-right">
          <button id="btn-pause-all"
                  class="btn-pause-all"
                  title="${i18n.t('shell_pause_all_title') || 'Pause every running campaign'}">
            ${icon('pause', 'sm')}
            <span class="btn-pause-all-label">${i18n.t('shell_pause_all') || 'Pause all'}</span>
          </button>
          <div class="lang-switcher" role="tablist">
            <button id="btn-lang-zh" class="lang-btn ${locale === 'zh' ? 'active' : ''}" role="tab" aria-selected="${locale === 'zh'}">ZH</button>
            <button id="btn-lang-en" class="lang-btn ${locale === 'en' ? 'active' : ''}" role="tab" aria-selected="${locale === 'en'}">EN</button>
          </div>
          <span id="campaign-status-badge" class="campaign-badge" data-i18n="nav_no_campaign">${i18n.t('nav_no_campaign')}</span>
          <div class="nav-status" title="${i18n.t('nav_agents_online')}">
            <span class="status-dot"></span>
            <span class="status-text">${i18n.t('nav_agents_online')}</span>
          </div>
        </div>
      </div>
    `;
  }

  _renderFooter() {
    const footer = document.getElementById('app-footer');
    if (!footer) return;
    footer.innerHTML = `
      <div class="footer-inner">
        <span>${i18n.t('footer_text')}</span>
      </div>
    `;
  }

  _bindNav() {
    const wrap = document.getElementById('nav-agents-wrap');
    const btn  = document.getElementById('nav-agents-btn');
    if (!btn || !wrap) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleAgentsMenu();
    });

    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this._closeAgentsMenu(); btn.focus(); }
    });

    document.addEventListener('click', this._closeAgentsMenu);
  }

  _bindLang() {
    document.getElementById('btn-lang-zh')?.addEventListener('click', () => i18n.setLocale('zh'));
    document.getElementById('btn-lang-en')?.addEventListener('click', () => i18n.setLocale('en'));
  }

  _bindPauseAll() {
    const btn = document.getElementById('btn-pause-all');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const oag = window.OAG;
      const api = oag?.api;
      if (!api?.listCampaigns || !api?.pauseCampaign) return;

      const PAUSEABLE_STATES = new Set(['DEPLOYED', 'MONITORING', 'OPTIMIZING']);
      const isPauseable = (s) =>
        PAUSEABLE_STATES.has(s) || (typeof s === 'string' && s.startsWith('LOOP_'));

      btn.disabled = true;
      const label = btn.querySelector('.btn-pause-all-label');
      const original = label?.textContent;
      if (label) label.textContent = i18n.t('shell_pause_all_running') || 'Pausing…';

      try {
        const resp = await api.listCampaigns({ limit: 100 });
        if (!resp?.success) throw new Error(resp?.error || 'list failed');

        const items = resp.data?.items || [];
        const targets = items.filter(c => isPauseable(c.status));

        if (targets.length === 0) {
          if (label) label.textContent = i18n.t('shell_pause_all_none') || 'Nothing running';
          setTimeout(() => { if (label) label.textContent = original; btn.disabled = false; }, 1600);
          return;
        }

        const confirmMsg = (i18n.t('shell_pause_all_confirm')
          || 'Pause {n} running campaign(s)? Their pipelines will halt until resumed.'
        ).replace('{n}', targets.length);
        if (!window.confirm(confirmMsg)) {
          if (label) label.textContent = original;
          btn.disabled = false;
          return;
        }

        const results = await Promise.all(targets.map(async (c) => {
          try {
            const r = await api.pauseCampaign(c.id);
            return { id: c.id, status: c.status, ok: !!r?.success, error: r?.error };
          } catch (e) {
            return { id: c.id, status: c.status, ok: false, error: e?.message || String(e) };
          }
        }));

        const okResults = results.filter(r => r.ok);
        const failedResults = results.filter(r => !r.ok);

        // Optimistically reflect into the in-browser orchestrator map so any
        // currently-mounted page (Hub strip, /campaigns row, Orchestrator FSM)
        // re-paints with PAUSED before the WS event lands.
        try {
          const map = oag?.orchestrator?.campaigns;
          if (map?.set) {
            okResults.forEach(r => {
              const entry = map.get(r.id);
              if (entry) { entry.status = 'PAUSED'; map.set(r.id, entry); }
            });
          }
        } catch {}

        // Surface failures with their actual server error so the user
        // doesn't see a green "paused" toast when nothing actually paused.
        if (failedResults.length > 0) {
          const summary = failedResults
            .map(r => `${r.id.slice(0,8)} (${r.status}): ${r.error || 'unknown'}`)
            .join('\n');
          console.warn('[shell] pause-all partial failure', failedResults);
          if (okResults.length === 0) {
            // Nothing actually paused — be loud.
            alert(
              (i18n.t('shell_pause_all_all_failed')
                || 'Could not pause any campaign. Server said:\n\n')
              + summary
            );
          } else {
            // Some succeeded — show a non-blocking notice.
            alert(
              (i18n.t('shell_pause_all_some_failed')
                || 'Paused {ok} of {total}. Failures:\n\n')
                .replace('{ok}', okResults.length)
                .replace('{total}', results.length)
              + summary
            );
          }
        }

        if (label) {
          label.textContent = failedResults.length > 0
            ? `${okResults.length}/${results.length} ${i18n.t('shell_pause_all_partial') || 'paused'}`
            : `${okResults.length} ${i18n.t('shell_pause_all_ok') || 'paused'}`;
        }
        setTimeout(() => { if (label) label.textContent = original; btn.disabled = false; }, 1800);
      } catch (e) {
        console.error('[shell] pause-all failed', e);
        if (label) label.textContent = i18n.t('shell_pause_all_err') || 'Pause failed';
        setTimeout(() => { if (label) label.textContent = original; btn.disabled = false; }, 1800);
      }
    });
  }

  _toggleAgentsMenu() {
    this._agentsMenuOpen ? this._closeAgentsMenu() : this._openAgentsMenu();
  }

  _openAgentsMenu() {
    const wrap = document.getElementById('nav-agents-wrap');
    const btn  = document.getElementById('nav-agents-btn');
    if (!wrap || !btn) return;
    wrap.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    this._agentsMenuOpen = true;
  }

  _closeAgentsMenu() {
    const wrap = document.getElementById('nav-agents-wrap');
    const btn  = document.getElementById('nav-agents-btn');
    if (!wrap || !btn) return;
    wrap.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    this._agentsMenuOpen = false;
  }

  _highlightCurrent(path) {
    document.querySelectorAll('[data-route]').forEach(el => {
      const target = el.dataset.route;
      const isActive = target === path
        || (target === '/agents/' + path.split('/')[2] && path.startsWith('/agents/'));
      el.classList.toggle('active', isActive);
      if (isActive) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }
}
