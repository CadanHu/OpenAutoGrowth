/*
 * Analysis Agent Page — performance report + attribution selector.
 * Spec: docs/frontend/07-analysis-page-spec.md
 *
 * Data sources:
 *   - eventBus.history['ReportGenerated']  → Overview, Attribution, Runs, Logs
 *   - eventBus.history['AnomalyDetected']  → Anomalies tab, Logs
 *   - orchestrator.campaigns.get(id).constraints.channels OR backend campaign data
 *     → channel list for the Attribution matrix
 *
 * Attribution algorithms run client-side as pure functions over the metrics
 * already received. v0.0.2 synthesizes per-channel splits via deterministic
 * hash; v0.0.3 will read real touchpoint data.
 */

import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID = 'analysis';

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()   { return window.OAG || {}; }
function t(k, d)    { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function reportEvents() {
  return (getCtx().eventBus?.history || []).filter(e => e.event_type === 'ReportGenerated');
}
function anomalyEvents() {
  return (getCtx().eventBus?.history || []).filter(e => e.event_type === 'AnomalyDetected');
}
function latestReport() {
  const list = reportEvents();
  return list.length ? list[list.length - 1] : null;
}
function reportMetrics(event) {
  // Frontend Analysis publishes { metrics: {...summary...} }
  // Backend publishes        { metrics: {ctr, roas, cvr, impressions, ...} }
  return event?.payload?.metrics || {};
}
function reportAnomalies(event) {
  return event?.payload?.anomalies || [];
}

// Pull channels list for Attribution matrix.
// Tries orchestrator.campaigns first (in-browser path), then falls back
// to a sensible default for backend-driven campaigns.
function channelsForCampaign(campaignId) {
  const ctx = getCtx();
  const camp = ctx.orchestrator?.campaigns?.get?.(campaignId);
  const channels = camp?.constraints?.channels;
  if (Array.isArray(channels) && channels.length) return channels;
  return ['tiktok', 'meta', 'google'];  // sensible default; spec §7
}

function fmtNum(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (opts.percent) return (n * 100).toFixed(2) + '%';
  if (opts.money)   return Math.round(n).toLocaleString();
  if (opts.ratio)   return n.toFixed(2) + '×';
  return Math.round(n).toLocaleString();
}

// ── Attribution algorithms (pure) ─────────────────────────────────
// Returns weight array summing to 1, indexed by channel.
function attributionWeights(modelId, n) {
  if (n <= 1) return [1];
  switch (modelId) {
    case 'last_touch':  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0));
    case 'first_touch': return Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));
    case 'linear':      return Array(n).fill(1 / n);
    case 'time_decay': {
      // Most recent (index n-1) gets full weight; each earlier touch halved.
      const raw = Array.from({ length: n }, (_, i) => Math.pow(0.5, n - 1 - i));
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map(w => w / sum);
    }
    case 'position_based': {
      // First + last 40% each, middle splits 20%.
      if (n === 2) return [0.5, 0.5];
      const middle = 0.2 / (n - 2);
      return Array.from({ length: n }, (_, i) =>
        i === 0 || i === n - 1 ? 0.4 : middle
      );
    }
    default: return Array(n).fill(1 / n);
  }
}

const MODELS = ['last_touch', 'first_touch', 'linear', 'time_decay', 'position_based'];
const MODEL_LABEL_KEY = {
  last_touch:     'analysis_model_last',
  first_touch:    'analysis_model_first',
  linear:         'analysis_model_linear',
  time_decay:     'analysis_model_decay',
  position_based: 'analysis_model_position',
};

// Deterministic hash for channel-spend split (placeholder for real data).
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function syntheticChannelSplit(channels, totalSpend, reportId) {
  // Each channel gets a weight based on hash(reportId + channel),
  // normalized to sum=1, multiplied by totalSpend.
  const weights = channels.map(c => (hashStr(reportId + ':' + c) % 100) + 30);
  const sum = weights.reduce((a, b) => a + b, 0);
  return channels.map((c, i) => ({
    channel: c,
    spend: totalSpend * (weights[i] / sum),
  }));
}

// ── Module-level state ────────────────────────────────────────────
let frame = null;
let currentModel = 'linear';

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  const event = latestReport();
  const m = reportMetrics(event);
  const anomCount = (event?.payload?.anomalies || []).length;

  panel.innerHTML = `
    <div class="metric-row">
      <div class="metric-box">
        <span class="metric-label">${t('analysis_metric_roas', 'ROAS')}</span>
        <span class="metric-value">${fmtNum(m.roas, { ratio: true })}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('analysis_metric_ctr', 'CTR')}</span>
        <span class="metric-value">${fmtNum(m.ctr, { percent: true })}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('analysis_metric_revenue', 'Revenue')}</span>
        <span class="metric-value">${fmtNum(m.revenue, { money: true })}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('analysis_metric_spend', 'Spend')}</span>
        <span class="metric-value">${fmtNum(m.spend, { money: true })}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('analysis_metric_anomalies', 'Anomalies')}</span>
        <span class="metric-value">${anomCount}</span>
      </div>
    </div>

    <div class="panel-card">
      <header class="panel-card-head"><h3>${t('analysis_last_summary', 'Last Report Summary')}</h3></header>
      <div class="panel-card-body">
        ${event ? renderReportSummary(event, m) : `<p class="muted">${t('analysis_no_report', 'No report yet — launch a campaign from Hub to generate one.')}</p>`}
      </div>
    </div>
  `;

  setStatus(event ? t('analysis_status_ready', 'Reporting') : t('metric_idle', 'Idle'));
}

function renderReportSummary(event, m) {
  return `
    <div class="kv-grid">
      <div><span class="kv-k">${t('analysis_kv_report_id', 'Report')}</span><span class="kv-v">${escapeHtml(event.payload?.report_id || event.id?.slice(0, 8) || '—')}…</span></div>
      <div><span class="kv-k">${t('agent_campaign_id', 'Campaign')}</span><span class="kv-v">${event.campaign_id?.slice(0, 8) || '—'}…</span></div>
      <div><span class="kv-k">${t('analysis_kv_impressions', 'Impressions')}</span><span class="kv-v">${fmtNum(m.impressions)}</span></div>
      <div><span class="kv-k">${t('analysis_kv_clicks', 'Clicks')}</span><span class="kv-v">${fmtNum(m.clicks)}</span></div>
      <div><span class="kv-k">${t('analysis_kv_conv', 'Conversions')}</span><span class="kv-v">${fmtNum(m.conversions)}</span></div>
      <div><span class="kv-k">${t('agent_time', 'Time')}</span><span class="kv-v">${fmtTime(event.occurred_at)}</span></div>
    </div>
  `;
}

// ── Tab: Attribution (specialization) ─────────────────────────────
function renderAttribution(panel) {
  function paint() {
    const event = latestReport();
    if (!event) {
      panel.innerHTML = `
        <div class="dag-empty">
          <p>${t('analysis_attr_empty', 'No report yet — once a campaign runs, attribution rolls up here.')}</p>
        </div>
      `;
      return;
    }
    const m = reportMetrics(event);
    const reportId = event.payload?.report_id || event.id || 'r';
    const channels = channelsForCampaign(event.campaign_id);
    const totalSpend = Number(m.spend) || 0;
    const totalRevenue = Number(m.revenue) || 0;
    const split = syntheticChannelSplit(channels, totalSpend, reportId);

    const weights = attributionWeights(currentModel, channels.length);
    const linearWeights = attributionWeights('linear', channels.length);

    const rows = channels.map((ch, i) => {
      const channelSpend = split[i].spend;
      const channelRevenue = totalRevenue * weights[i];
      const channelRoas = channelSpend > 0 ? channelRevenue / channelSpend : 0;
      const linearRevenue = totalRevenue * linearWeights[i];
      const linearRoas = channelSpend > 0 ? linearRevenue / channelSpend : 0;
      const delta = channelRoas - linearRoas;
      return { ch, channelSpend, channelRevenue, channelRoas, delta };
    });

    panel.innerHTML = `
      <div class="attr-toolbar">
        <span class="attr-toolbar-label">${t('analysis_attr_model', 'Attribution model')}</span>
        <div class="attr-model-segmented" role="tablist">
          ${MODELS.map(id => `
            <button type="button"
                    role="tab"
                    class="attr-model-btn ${id === currentModel ? 'active' : ''}"
                    data-model="${id}"
                    aria-selected="${id === currentModel}">
              ${t(MODEL_LABEL_KEY[id], id)}
            </button>
          `).join('')}
        </div>
      </div>

      <table class="attr-table">
        <thead>
          <tr>
            <th>${t('analysis_attr_channel', 'Channel')}</th>
            <th class="num">${t('analysis_attr_spend', 'Spend')}</th>
            <th class="num">${t('analysis_attr_revenue', 'Revenue')}</th>
            <th class="num">${t('analysis_metric_roas', 'ROAS')}</th>
            <th class="num">${t('analysis_attr_delta', 'Δ vs Linear')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><span class="channel-pill">${escapeHtml(r.ch)}</span></td>
              <td class="num">${fmtNum(r.channelSpend, { money: true })}</td>
              <td class="num">${fmtNum(r.channelRevenue, { money: true })}</td>
              <td class="num">${fmtNum(r.channelRoas, { ratio: true })}</td>
              <td class="num ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : ''}">
                ${r.delta === 0 ? '0.00' : (r.delta > 0 ? '+' : '') + r.delta.toFixed(2)}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <p class="muted tiny attr-disclaimer">
        ${channels.length === 1
          ? t('analysis_attr_single', 'Only one channel — all attribution models converge to 100% credit.')
          : t('analysis_attr_synthetic', 'Per-channel spend split is synthesized via deterministic hash. Real touchpoint data lands in v0.0.3.')}
      </p>
    `;

    // Wire model selector
    panel.querySelectorAll('[data-model]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentModel = btn.dataset.model;
        paint();
      });
    });
  }

  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('ReportGenerated', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Anomalies ────────────────────────────────────────────────
function renderAnomalies(panel) {
  function paint() {
    const events = anomalyEvents();
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    events.forEach(e => {
      const sev = (e.payload?.severity || 'LOW').toUpperCase();
      counts[sev] = (counts[sev] || 0) + 1;
    });

    panel.innerHTML = `
      <div class="anomaly-chip-row">
        <span class="anomaly-chip high">HIGH ${counts.HIGH}</span>
        <span class="anomaly-chip medium">MEDIUM ${counts.MEDIUM}</span>
        <span class="anomaly-chip low">LOW ${counts.LOW}</span>
      </div>
      ${events.length === 0
        ? `<div class="dag-empty"><p>${t('analysis_no_anomalies', 'No anomalies detected. ✨')}</p></div>`
        : `<ul class="anomaly-list">
            ${events.slice().reverse().map(e => `
              <li class="anomaly-row sev-${(e.payload?.severity || 'low').toLowerCase()}">
                <span class="anomaly-time">${fmtTime(e.occurred_at)}</span>
                <span class="anomaly-metric">${escapeHtml(e.payload?.metric || '—')}</span>
                <span class="anomaly-sev">${escapeHtml(e.payload?.severity || '—')}</span>
                <span class="anomaly-desc">${escapeHtml(e.payload?.description || '')}</span>
              </li>
            `).join('')}
          </ul>`}
    `;
  }
  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('AnomalyDetected', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Runs ─────────────────────────────────────────────────────
function renderRuns(panel) {
  const events = reportEvents().slice().reverse();
  panel.innerHTML = events.length
    ? `<ul class="runs-list">${events.map(renderRunRow).join('')}</ul>`
    : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`;
  panel.querySelectorAll('.run-row').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

function renderRunRow(event) {
  const m = reportMetrics(event);
  return `
    <li class="run-row" data-id="${event.id}">
      <header class="run-row-head">
        <span class="run-row-time">${fmtTime(event.occurred_at)}</span>
        <span class="run-row-summary">
          ROAS ${fmtNum(m.roas, { ratio: true })} · ${(event.payload?.anomalies || []).length} anomalies
          · ${event.campaign_id?.slice(0, 8) || '—'}…
        </span>
        <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
        ${icon('chevron-down', 'sm')}
      </header>
      <div class="run-row-body">
        <pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
      </div>
    </li>
  `;
}

// ── Tab: Logs ─────────────────────────────────────────────────────
function renderLogs(panel) {
  function paint() {
    const events = (getCtx().eventBus?.history || []).filter(e =>
      e.event_type === 'ReportGenerated' || e.event_type === 'AnomalyDetected'
    );
    panel.innerHTML = `
      <div class="logs-view">
        ${events.length
          ? events.slice().reverse().map(e => `
            <div class="log-line">
              <span class="log-time">${fmtTime(e.occurred_at)}</span>
              <span class="log-type">${e.event_type}</span>
              <span class="log-msg">${
                e.event_type === 'ReportGenerated'
                  ? `ROAS ${fmtNum(reportMetrics(e).roas, { ratio: true })}`
                  : escapeHtml(e.payload?.metric || '') + ' ' + escapeHtml(e.payload?.severity || '')
              }</span>
            </div>
          `).join('')
          : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`}
      </div>
    `;
  }
  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const u1 = ctx.eventBus.subscribe('ReportGenerated', paint);
  const u2 = ctx.eventBus.subscribe('AnomalyDetected', paint);
  return () => { try { u1(); u2(); } catch {} };
}

// ── Page module ───────────────────────────────────────────────────
export default {
  titleKey: 'page_analysis_title',

  async mount(outlet, ctx) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    const requestedTab = ctx?.query?.tab;

    frame = createAgentFrame({
      agent,
      defaultTabId: requestedTab || 'overview',
      tabs: [
        { id: 'overview',    labelKey: 'agent_tab_overview',     label: 'Overview',    icon: 'activity',   render: renderOverview },
        { id: 'attribution', labelKey: 'analysis_tab_attr',      label: 'Attribution', icon: 'bar-chart',  render: renderAttribution },
        { id: 'anomalies',   labelKey: 'analysis_tab_anomalies', label: 'Anomalies',   icon: 'activity',   render: renderAnomalies },
        { id: 'runs',        labelKey: 'agent_tab_runs',         label: 'Runs',        icon: 'clock',      render: renderRuns },
        { id: 'logs',        labelKey: 'agent_tab_logs',         label: 'Logs',        icon: 'activity',   render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
  },
};
