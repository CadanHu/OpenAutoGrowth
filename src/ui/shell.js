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
        </nav>

        <div class="nav-right">
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
