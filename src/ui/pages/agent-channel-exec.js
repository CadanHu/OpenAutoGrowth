/*
 * ChannelExec Agent Page — credentials sandbox + deploy observability.
 * Spec: docs/frontend/09-channel-exec-page-spec.md
 *
 * Data sources:
 *   - eventBus.history['AdDeployed']                  → Overview / Deploys / Logs
 *   - orchestrator.agents.get('ChannelExec').adapters → Credentials (channel inventory)
 *   - localStorage 'oag.channel-exec.credentials.v1'  → Credentials (alias / env / test result)
 *
 * Real secret storage and platform OAuth land in v0.0.3 — adapters are still
 * MockAdsAdapter, so Test connection ALWAYS succeeds for wired channels.
 */

import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';
import {
  getActiveCid,
  subscribeCampaignChange,
  renderCampaignBanner,
} from '../campaign-context.js';

const AGENT_ID    = 'channel-exec';
const KNOWN_CHANNELS = ['tiktok', 'meta', 'google', 'wechat'];
const STORAGE_KEY = 'oag.channel-exec.credentials.v1';

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()  { return window.OAG || {}; }
function t(k, d)   { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function activeCampaign() {
  const cid = getActiveCid();
  if (!cid) return null;
  return getCtx().orchestrator?.campaigns?.get?.(cid) || { campaign_id: cid };
}
function deployEvents() {
  const cid = getActiveCid();
  return (getCtx().eventBus?.history || [])
    .filter(e => e.event_type === 'AdDeployed' && (!cid || e.campaign_id === cid));
}
function getAgent() { return getCtx().orchestrator?.agents?.get?.('ChannelExec') || null; }

// Credential store — read every time so other tabs see updates.
function defaultCred() {
  return { env: 'sandbox', alias: '', last_tested_at: null, last_test_ok: null };
}
function loadCreds() {
  let stored = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) || {};
  } catch (e) {
    console.warn('[channel-exec] cred load failed', e);
  }
  const out = {};
  for (const ch of KNOWN_CHANNELS) {
    out[ch] = { ...defaultCred(), ...(stored[ch] || {}) };
  }
  return out;
}
function saveCreds(creds) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    storageBlocked = false;
  } catch (e) {
    console.warn('[channel-exec] cred save failed', e);
    storageBlocked = true;
  }
}

let storageBlocked = false;

function statusOf(channel, cred, agent) {
  const hasAdapter = !!agent?.adapters?.[channel];
  if (!hasAdapter) return 'missing';
  if (cred.last_test_ok === false) return 'error';
  if (cred.alias && cred.last_test_ok === true) return 'connected';
  if (cred.alias && cred.last_tested_at == null) return 'untested';
  return 'sandbox';
}

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  function paint() {
    const agent = getAgent();
    const creds = loadCreds();
    const events = deployEvents();
    const wired = KNOWN_CHANNELS.filter(c => agent?.adapters?.[c]).length;
    const connected = KNOWN_CHANNELS.filter(c => statusOf(c, creds[c], agent) === 'connected').length;
    const last = events.length ? events[events.length - 1] : null;

    panel.innerHTML = `
      ${renderCampaignBanner({ campaign: activeCampaign(), i18nT: t })}
      <div class="replan-banner">
        ${icon('sparkles', 'sm')}
        <span>${t('channelexec_sandbox_banner', 'Mock adapter mode · Real platform deploy lands in v0.0.3.')}</span>
      </div>

      <div class="metric-row">
        <div class="metric-box">
          <span class="metric-label">${t('channelexec_metric_configured', 'Channels Configured')}</span>
          <span class="metric-value">${wired}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('channelexec_metric_connected', 'Channels Connected')}</span>
          <span class="metric-value">${connected}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('channelexec_metric_deploys', 'Total Deploys')}</span>
          <span class="metric-value">${events.length}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('channelexec_metric_last', 'Last Deploy')}</span>
          <span class="metric-value tiny">${fmtTime(last?.occurred_at)}</span>
        </div>
      </div>

      ${last ? renderLastDeployCard(last) : `<p class="muted">${t('channelexec_no_deploy', 'No deploy yet — once a campaign reaches ChannelExec, you will see it here.')}</p>`}
    `;

    setStatus(events.length ? t('channelexec_status_active', 'Live') : t('metric_idle', 'Idle'));
  }
  paint();

  const ctx = getCtx();
  const unsubCid = subscribeCampaignChange(paint);
  if (!ctx.eventBus) return () => { try { unsubCid(); } catch {} };
  const unsub = ctx.eventBus.subscribe('AdDeployed', paint);
  return () => { try { unsubCid(); } catch {} try { unsub(); } catch {} };
}

function renderLastDeployCard(event) {
  const platforms = event.payload?.platforms || [];
  const ids       = event.payload?.ad_campaign_ids || [];
  return `
    <div class="panel-card">
      <header class="panel-card-head"><h3>${t('channelexec_last_deploy', 'Last Deploy')}</h3></header>
      <div class="panel-card-body">
        <div class="kv-grid">
          <div><span class="kv-k">campaign</span><span class="kv-v">${escapeHtml(event.campaign_id || '—')}</span></div>
          <div><span class="kv-k">time</span><span class="kv-v">${fmtTime(event.occurred_at)}</span></div>
          <div><span class="kv-k">platforms</span><span class="kv-v">${platforms.map(p => `<span class="channel-pill">${escapeHtml(p)}</span>`).join(' ')}</span></div>
        </div>
        <details class="last-deploy-ids">
          <summary>${t('channelexec_show_ids', 'Show ad campaign IDs')}</summary>
          <ul class="id-list">${ids.map(id => `<li><code class="code-inline">${escapeHtml(id)}</code></li>`).join('')}</ul>
        </details>
      </div>
    </div>
  `;
}

// ── Tab: Credentials (specialization) ─────────────────────────────
function renderCredentials(panel) {
  const agent = getAgent();
  if (!agent) {
    panel.innerHTML = `<p class="muted">${t('channelexec_agent_unavailable', 'ChannelExec agent not available.')}</p>`;
    return;
  }
  let creds = loadCreds();

  function paint() {
    panel.innerHTML = `
      ${storageBlocked ? `<div class="replan-banner warn">${icon('alert-triangle', 'sm')}<span>${t('channelexec_storage_blocked', 'localStorage is blocked — credential edits will be lost on reload.')}</span></div>` : ''}
      <div class="cred-grid">
        ${KNOWN_CHANNELS.map(ch => renderCredCard(ch, creds[ch], agent)).join('')}
      </div>
    `;
    KNOWN_CHANNELS.forEach(ch => wireCredCard(ch));
  }

  function renderCredCard(channel, cred, agent) {
    const status = statusOf(channel, cred, agent);
    const adapterName = agent.adapters?.[channel]?.constructor?.name || '—';
    const disabled = status === 'missing';

    return `
      <article class="panel-card cred-card" data-channel="${channel}">
        <header class="panel-card-head cred-card-head">
          <span class="channel-pill">${escapeHtml(channel)}</span>
          <span class="status-pill cred-status cred-status-${status}">
            <span class="dot"></span>
            <span>${t('channelexec_status_' + status, status)}</span>
          </span>
        </header>
        <div class="panel-card-body">
          <div class="kv-grid cred-kv">
            <div>
              <span class="kv-k">${t('channelexec_kv_adapter', 'Adapter')}</span>
              <span class="kv-v">${escapeHtml(adapterName)}</span>
            </div>
            <div>
              <span class="kv-k">${t('channelexec_kv_env', 'Env')}</span>
              <select class="modal-input" data-cred-env ${disabled ? 'disabled' : ''}>
                <option value="sandbox" ${cred.env === 'sandbox' ? 'selected' : ''}>sandbox</option>
                <option value="prod"    ${cred.env === 'prod'    ? 'selected' : ''}>prod</option>
              </select>
            </div>
            <div>
              <span class="kv-k">${t('channelexec_kv_alias', 'Alias')}</span>
              <input type="text" class="modal-input" data-cred-alias
                     placeholder="${t('channelexec_kv_alias_placeholder', 'Brand main…')}"
                     value="${escapeHtml(cred.alias)}" ${disabled ? 'disabled' : ''}>
            </div>
            <div>
              <span class="kv-k">${t('channelexec_kv_tested', 'Last tested')}</span>
              <span class="kv-v">${fmtTime(cred.last_tested_at)}</span>
            </div>
          </div>
          <div class="form-actions cred-actions">
            <span class="muted tiny" data-cred-status></span>
            <button type="button" class="btn btn-secondary" data-cred-reset
                    ${disabled ? 'disabled' : ''}>${t('channelexec_btn_reset', 'Reset')}</button>
            <button type="button" class="btn btn-primary" data-cred-test
                    ${disabled ? 'disabled' : ''}>${t('channelexec_btn_test', 'Test connection')}</button>
          </div>
        </div>
      </article>
    `;
  }

  function wireCredCard(channel) {
    const card = panel.querySelector(`.cred-card[data-channel="${channel}"]`);
    if (!card) return;

    card.querySelector('[data-cred-env]')?.addEventListener('change', e => {
      creds[channel].env = e.target.value;
      saveCreds(creds);
    });

    card.querySelector('[data-cred-alias]')?.addEventListener('blur', e => {
      const next = e.target.value.trim();
      if (next === creds[channel].alias) return;
      creds[channel].alias = next;
      // Editing alias invalidates last test.
      creds[channel].last_test_ok = null;
      creds[channel].last_tested_at = null;
      saveCreds(creds);
      paint();
    });

    card.querySelector('[data-cred-reset]')?.addEventListener('click', () => {
      creds[channel] = defaultCred();
      saveCreds(creds);
      paint();
    });

    card.querySelector('[data-cred-test]')?.addEventListener('click', () => testConnection(channel, card));
  }

  async function testConnection(channel, card) {
    const adapter = agent.adapters?.[channel];
    const statusEl = card.querySelector('[data-cred-status]');
    if (!adapter) {
      statusEl.textContent = t('channelexec_no_adapter', 'No adapter wired');
      return;
    }
    statusEl.textContent = t('channelexec_testing', 'Testing…');
    try {
      await adapter.createCampaign({ budget: 1 });
      creds[channel].last_test_ok = true;
      creds[channel].last_tested_at = new Date().toISOString();
      saveCreds(creds);
      paint();
    } catch (err) {
      creds[channel].last_test_ok = false;
      creds[channel].last_tested_at = new Date().toISOString();
      saveCreds(creds);
      paint();
      const card2 = panel.querySelector(`.cred-card[data-channel="${channel}"]`);
      const errEl = card2?.querySelector('[data-cred-status]');
      if (errEl) errEl.textContent = err.message || 'failed';
    }
  }

  paint();
}

// ── Tab: Deploys ──────────────────────────────────────────────────
function renderDeploys(panel) {
  function paint() {
    const events = deployEvents().slice().reverse();
    if (!events.length) {
      panel.innerHTML = `<div class="dag-empty"><p>${t('channelexec_no_deploy_short', 'No deploys yet.')}</p></div>`;
      return;
    }
    panel.innerHTML = `
      <table class="attr-table">
        <thead>
          <tr>
            <th>${t('channelexec_col_time', 'Time')}</th>
            <th>${t('channelexec_col_campaign', 'Campaign')}</th>
            <th>${t('channelexec_col_platforms', 'Platforms')}</th>
            <th>${t('channelexec_col_ids', 'Ad Campaign IDs')}</th>
          </tr>
        </thead>
        <tbody>
          ${events.map(renderDeployRow).join('')}
        </tbody>
      </table>
      <ul class="runs-list deploys-detail">${events.map(renderDeployDetail).join('')}</ul>
    `;
    panel.querySelectorAll('.run-row').forEach(row => {
      row.addEventListener('click', () => row.classList.toggle('expanded'));
    });
  }

  function renderDeployRow(e) {
    const platforms = e.payload?.platforms || [];
    const ids = e.payload?.ad_campaign_ids || [];
    return `
      <tr>
        <td>${fmtTime(e.occurred_at)}</td>
        <td><code class="code-inline">${escapeHtml((e.campaign_id || '—').slice(0, 12))}…</code></td>
        <td>${platforms.map(p => `<span class="channel-pill">${escapeHtml(p)}</span>`).join(' ')}</td>
        <td class="num">${ids.length}</td>
      </tr>
    `;
  }

  function renderDeployDetail(e) {
    return `
      <li class="run-row" data-id="${e.id}">
        <header class="run-row-head">
          <span class="run-row-time">${fmtTime(e.occurred_at)}</span>
          <span class="run-row-summary">${(e.payload?.platforms || []).join(', ')} · ${(e.campaign_id || '—').slice(0, 8)}…</span>
          <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
          ${icon('chevron-down', 'sm')}
        </header>
        <div class="run-row-body">
          <pre>${escapeHtml(JSON.stringify(e.payload, null, 2))}</pre>
        </div>
      </li>
    `;
  }

  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('AdDeployed', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Logs ─────────────────────────────────────────────────────
function renderLogs(panel) {
  let fetched = false;
  async function paint() {
    const ctx = getCtx();
    if (!fetched && ctx.api?.getSystemEvents) {
      fetched = true;
      try {
        const remote = await ctx.api.getSystemEvents();
        const existing = new Set((ctx.eventBus?.history || []).map(e => e.id));
        let added = false;
        remote.forEach(e => {
          if (!existing.has(e.id)) { ctx.eventBus?.history.push(e); added = true; }
        });
        if (added) {
           ctx.eventBus?.history.sort((a,b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
           return paint();
        }
      } catch(e) {}
    }
    const events = deployEvents();
    panel.innerHTML = `
      <div class="logs-view">
        ${events.length
          ? events.slice().reverse().map(e => {
              const summary = `${(e.payload?.platforms || []).join(', ') || '—'} · ${(e.campaign_id || '').slice(0, 8)}…`;
              return `
                <div class="log-line">
                  <span class="log-time">${fmtTime(e.occurred_at)}</span>
                  <span class="log-type">${e.event_type}</span>
                  <span class="log-msg">${escapeHtml(summary)}</span>
                </div>
              `;
            }).join('')
          : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`}
      </div>
    `;
  }
  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('AdDeployed', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Page module ───────────────────────────────────────────────────
let frame = null;

export default {
  titleKey: 'page_channelexec_title',

  async mount(outlet, ctx) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    const requestedTab = ctx?.query?.tab;

    frame = createAgentFrame({
      agent,
      defaultTabId: requestedTab || 'overview',
      tabs: [
        { id: 'overview',    labelKey: 'agent_tab_overview',     label: 'Overview',    icon: 'activity',    render: renderOverview },
        { id: 'credentials', labelKey: 'channelexec_tab_creds',  label: 'Credentials', icon: 'key',         render: renderCredentials },
        { id: 'deploys',     labelKey: 'channelexec_tab_deploys', label: 'Deploys',    icon: 'radio-tower', render: renderDeploys },
        { id: 'logs',        labelKey: 'agent_tab_logs',         label: 'Logs',        icon: 'activity',    render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
  },
};
