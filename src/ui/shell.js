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
import {
  getActiveCid,
  setActiveCid,
  resolveDefaultCid,
  subscribeCampaignChange,
  statusBadgeClass,
  prettyCampaignName,
  shortStatusLabel,
} from './campaign-context.js';

export class AppShell {
  constructor() {
    this._closeAgentsMenu = this._closeAgentsMenu.bind(this);
    this._agentsMenuOpen = false;
    this._closeCampaignMenu = this._closeCampaignMenu.bind(this);
    this._campaignMenuOpen = false;
    // Cached campaign list for the selector dropdown — avoids hammering
    // the API on every dropdown open. Refreshed on open if older than 5s.
    this._campaignsCache = { items: [], fetchedAt: 0 };
  }

  mount() {
    this._renderNavbar();
    this._renderFooter();
    this._bindNav();
    this._bindLang();
    this._bindPauseAll();
    this._bindCampaignSelector();
    this._renderUserChip();
    this._highlightCurrent(router.current_path());

    document.addEventListener('routeChanged', (e) => {
      this._highlightCurrent(e.detail.path);
      this._closeAgentsMenu();
      this._closeCampaignMenu();
      this._refreshCampaignChip();
    });

    document.addEventListener('languageChanged', () => {
      this._renderNavbar();
      this._renderFooter();
      this._bindNav();
      this._bindLang();
      this._bindPauseAll();
      this._bindCampaignSelector();
      this._renderUserChip();
      this._highlightCurrent(router.current_path());
    });

    document.addEventListener('auth:login',  () => this._renderUserChip());
    document.addEventListener('auth:logout', () => this._renderUserChip());

    // Update the chip whenever the global campaign-context changes — covers
    // selections made from any page (FSM sidebar, Memory dropdown, etc.).
    this._unsubCampaign = subscribeCampaignChange(() => this._refreshCampaignChip());

    // Auto-pick the most recently-updated campaign on first load if the
    // URL has no cid yet, so every page opens "to" something.
    this._maybeAutoSelect();

    // Poll the governance inbox so the nav-bar Approvals link wears an
    // accurate pending-count badge — campaigns sitting at
    // PAUSED_FOR_APPROVAL aren't actionable without going through here.
    this._refreshGovernanceCount();
    this._govPollTimer = setInterval(() => this._refreshGovernanceCount(), 15000);
  }

  async _refreshGovernanceCount() {
    const api = window.OAG?.api;
    if (!api?.listGovernanceInbox) return;
    try {
      const resp = await api.listGovernanceInbox({ status: 'OPEN' });
      const count = (resp?.success && Array.isArray(resp.data)) ? resp.data.length : 0;
      const pill = document.getElementById('nav-governance-count');
      if (!pill) return;
      if (count > 0) {
        pill.textContent = count > 99 ? '99+' : String(count);
        pill.hidden = false;
      } else {
        pill.hidden = true;
      }
    } catch { /* silent — auth errors are surfaced elsewhere */ }
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
          <a class="nav-link" href="#/governance" data-route="/governance" id="nav-governance">
            ${i18n.t('nav_governance') || 'Approvals'}
            <span class="nav-pill" id="nav-governance-count" hidden>0</span>
          </a>
          <a class="nav-link" href="#/integrations" data-route="/integrations">${i18n.t('nav_integrations') || 'Integrations'}</a>
          ${(window.OAG?.auth?.getUser?.()?.gov_roles || []).map(r => String(r).toUpperCase()).includes('ADMIN')
            ? `<a class="nav-link" href="#/users" data-route="/users">${i18n.t('nav_users') || 'Users'}</a>` : ''}
        </nav>

        <div class="nav-right">
          <div class="nav-dropdown" id="nav-campaign-wrap">
            <button class="campaign-chip" id="campaign-chip"
                    title="${i18n.t('shell_campaign_chip_title') || 'Currently viewing campaign — click to switch'}">
              <span class="status-indicator" data-campaign-dot></span>
              <span class="campaign-chip-text" data-campaign-text>${i18n.t('shell_campaign_chip_loading') || 'Loading…'}</span>
              ${icon('chevron-down', 'sm')}
            </button>
            <div class="nav-menu campaign-menu" id="campaign-menu" role="menu" aria-hidden="true">
              <div class="campaign-menu-list" data-campaign-list>
                <div class="campaign-menu-empty muted tiny">${i18n.t('shell_campaign_chip_loading') || 'Loading…'}</div>
              </div>
            </div>
          </div>
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
          <div class="nav-status" title="${i18n.t('nav_agents_online')}">
            <span class="status-dot"></span>
            <span class="status-text">${i18n.t('nav_agents_online')}</span>
          </div>
          <div class="user-chip" id="user-chip" style="display:flex; align-items:center; gap:8px; padding:4px 10px; border-radius: var(--radius-full); background: var(--bg-L1); font-size: 12px;"></div>
        </div>
      </div>
    `;
  }

  _renderUserChip() {
    const chip = document.getElementById('user-chip');
    if (!chip) return;
    const user = window.OAG?.auth?.getUser?.();
    if (!user) { chip.style.display = 'none'; return; }
    chip.style.display = 'flex';
    const initials = (user.email || '?')[0]?.toUpperCase() || '?';
    const roles = (user.gov_roles || []).join(',') || user.role || '';
    chip.innerHTML = `
      <span style="width:22px; height:22px; border-radius:50%; background: var(--accent-primary); color:#fff; display:inline-flex; align-items:center; justify-content:center; font-weight:600;">${initials}</span>
      <span style="line-height:1.1;">
        <strong style="display:block;">${user.email || ''}</strong>
        <small class="muted" style="font-size:10px;">${roles}</small>
      </span>
      <button id="btn-notify-prefs" class="btn btn-xs" title="Notification settings" style="margin-left:6px;">🔔</button>
      <button id="btn-logout" class="btn btn-xs" title="Sign out" style="margin-left:4px;">⎋</button>
    `;
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      window.OAG?.auth?.clearSession?.();
      location.reload();
    });
    document.getElementById('btn-notify-prefs')?.addEventListener('click', async () => {
      const mod = await import('./auth.js');
      mod.openNotifyPrefs(window.OAG.api);
    });
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

    // Carry the currently-selected campaign across nav clicks. Uses
    // `[data-route]` as the membership marker — covers Hub link, agent
    // menu items, Campaigns / Integrations links. We only modify the
    // navigation behavior when:
    //   • A cid is currently active
    //   • The clicked href is a hash route inside this app
    //   • The user didn't request a new tab (cmd/ctrl/shift/middle-click)
    //   • The destination doesn't already specify its own ?cid (avoid
    //     overriding deep-links like the campaigns row's git-merge button)
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-route]');
      if (!a) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      const cid = getActiveCid();
      if (!cid) return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('#/')) return;
      const [path, qs] = href.slice(1).split('?');
      const params = new URLSearchParams(qs || '');
      if (params.get('cid')) return;
      params.set('cid', cid);
      e.preventDefault();
      router.navigate(path, Object.fromEntries(params));
    }, true /* capture, before the default <a> handler */);
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

    // When navigating between top-level pages, automatically carry the
    // currently-selected campaign in the URL. Done by intercepting clicks
    // on `[data-route]` links — see `_bindNav`. (`href` itself stays
    // canonical so right-click → copy link still works without `?cid=`.)
  }

  // ── Campaign selector chip ─────────────────────────────────────────

  _bindCampaignSelector() {
    const wrap = document.getElementById('nav-campaign-wrap');
    const chip = document.getElementById('campaign-chip');
    if (!wrap || !chip) return;

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleCampaignMenu();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this._closeCampaignMenu(); chip.focus(); }
    });
    document.addEventListener('click', this._closeCampaignMenu);

    // Initial paint with whatever cid is in the URL right now.
    this._refreshCampaignChip();
  }

  _toggleCampaignMenu() {
    if (this._campaignMenuOpen) this._closeCampaignMenu();
    else this._openCampaignMenu();
  }

  async _openCampaignMenu() {
    const wrap = document.getElementById('nav-campaign-wrap');
    const menu = document.getElementById('campaign-menu');
    if (!wrap || !menu) return;
    wrap.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    this._campaignMenuOpen = true;

    await this._renderCampaignList(/* force refresh */ Date.now() - this._campaignsCache.fetchedAt > 5000);
  }

  _closeCampaignMenu() {
    const wrap = document.getElementById('nav-campaign-wrap');
    const menu = document.getElementById('campaign-menu');
    if (!wrap || !menu) return;
    wrap.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    this._campaignMenuOpen = false;
  }

  async _fetchCampaigns(force = false) {
    if (!force && this._campaignsCache.items.length && Date.now() - this._campaignsCache.fetchedAt < 5000) {
      return this._campaignsCache.items;
    }
    const api = window.OAG?.api;
    if (!api?.listCampaigns) return [];
    try {
      const resp = await api.listCampaigns({ limit: 100 });
      if (resp?.success && Array.isArray(resp.data?.items)) {
        const items = resp.data.items.slice().sort((a, b) => {
          const ta = new Date(a.updated_at || a.created_at || 0).getTime();
          const tb = new Date(b.updated_at || b.created_at || 0).getTime();
          return tb - ta;
        });
        this._campaignsCache = { items, fetchedAt: Date.now() };
        return items;
      }
    } catch (e) {
      console.warn('[shell] fetch campaigns failed', e);
    }
    return this._campaignsCache.items;
  }

  async _renderCampaignList(force) {
    const list = document.querySelector('[data-campaign-list]');
    if (!list) return;
    const items = await this._fetchCampaigns(force);
    const cid = getActiveCid();

    if (!items.length) {
      list.innerHTML = `<div class="campaign-menu-empty muted tiny">${i18n.t('shell_campaign_chip_none') || 'No campaigns yet — launch one from Hub.'}</div>`;
      return;
    }

    list.innerHTML = items.map(c => {
      const id = c.id || c.campaign_id;
      const stamp = c.updated_at || c.created_at;
      const cls = statusBadgeClass(c.status);
      const active = id === cid ? 'active' : '';
      return `
        <button class="campaign-menu-item ${active}" data-cid="${id}" type="button">
          <span class="campaign-menu-item-main">
            <span class="campaign-menu-item-name text-truncate">${escapeHtml(prettyCampaignName(c, id))}</span>
            <span class="tiny muted" style="display:flex; gap:6px;">
              <code class="code-inline" style="font-size:10px;">${id.slice(0, 8)}</code>
              <span>·</span>
              <span>${escapeHtml(fmtDateTime(stamp))}</span>
            </span>
          </span>
          <span class="status-badge ${cls}">${escapeHtml(shortStatusLabel(c.status))}</span>
        </button>
      `;
    }).join('');

    list.querySelectorAll('.campaign-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveCid(item.dataset.cid);
        this._closeCampaignMenu();
      });
    });
  }

  async _refreshCampaignChip() {
    const dot = document.querySelector('[data-campaign-dot]');
    const text = document.querySelector('[data-campaign-text]');
    if (!dot || !text) return;
    const cid = getActiveCid();
    if (!cid) {
      dot.className = 'status-indicator';
      text.textContent = i18n.t('shell_campaign_chip_none_short') || 'No campaign';
      return;
    }
    // Look up name/status from cache; if not yet loaded, fetch.
    let entry = this._campaignsCache.items.find(c => (c.id || c.campaign_id) === cid);
    if (!entry) {
      const items = await this._fetchCampaigns();
      entry = items.find(c => (c.id || c.campaign_id) === cid);
    }
    if (!entry) {
      dot.className = 'status-indicator';
      text.textContent = cid.slice(0, 8) + '…';
      return;
    }
    const cls = statusBadgeClass(entry.status);
    dot.className = `status-indicator ${cls === 'active' ? 'ok' : (cls === 'success' ? 'ok' : (cls === 'warning' ? 'warning' : ''))}`;
    const short = prettyCampaignName(entry, cid);
    text.innerHTML = `<span class="text-truncate">${escapeHtml(truncate(short, 28))}</span> <span class="status-badge ${cls}" style="margin-left:6px;">${escapeHtml(shortStatusLabel(entry.status))}</span>`;
  }

  async _maybeAutoSelect() {
    if (getActiveCid()) return;             // user/URL already specified
    const items = await this._fetchCampaigns();
    if (!items.length) {                    // nothing to pick — leave chip in "no campaign" state
      this._refreshCampaignChip();
      return;
    }
    const def = resolveDefaultCid(
      items.map(c => ({ ...c, campaign_id: c.id || c.campaign_id })),
      c => !['PAUSED', 'COMPLETED', 'DRAFT'].includes(c.status)
    );
    if (def) setActiveCid(def);             // dispatches queryChanged → chip refreshes
    else this._refreshCampaignChip();
  }
}

// ── Helpers (file-local, no leaking) ─────────────────────────────────
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
