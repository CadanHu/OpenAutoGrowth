/*
 * Strategy Agent Page — channel plan + budget allocation + what-if sandbox.
 * Spec: docs/frontend/08-strategy-page-spec.md
 *
 * Data sources:
 *   - eventBus.history['StrategyDecided']                       → Overview, Channel Plan, Runs, Logs
 *   - orchestrator.agents.get('Strategy').run({...})            → What-If preview (no persistence)
 *
 * Handles two strategy schemas (FE rule-based vs BE LLM-based) — fields
 * present in only one are conditionally rendered, never blank-padded.
 */

import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID = 'strategy';
const KNOWN_CHANNELS = ['tiktok', 'meta', 'google', 'wechat'];
const TARGETS = ['cold_start', 'lookalike_audience', 'reach_maximize'];

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()  { return window.OAG || {}; }
function t(k, d)   { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function strategyEvents() {
  return (getCtx().eventBus?.history || []).filter(e => e.event_type === 'StrategyDecided');
}
function latestStrategyEvent() {
  const list = strategyEvents();
  return list.length ? list[list.length - 1] : null;
}
function pickStrategy(event) {
  return event?.payload?.strategy || null;
}
function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}

// ── Module state ─────────────────────────────────────────────────
let frame = null;
let whatIfState = null;       // captured form input across tab re-renders
let lastWhatIfPlan = null;    // for Copy-as-JSON

function defaultWhatIfState() {
  return {
    target: 'cold_start',
    totalBudget: 50000,
    channels: ['tiktok', 'meta', 'google'],
    kpiMetric: 'ROAS',
    kpiTarget: 3.0,
  };
}

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  function paint() {
    const event = latestStrategyEvent();
    const strat = pickStrategy(event);
    const channelCount = strat?.channel_plan?.length || 0;
    const totalBudget = strat?.total_budget
      ?? strat?.channel_plan?.reduce((s, c) => s + (Number(c.budget) || 0), 0)
      ?? 0;
    const top = strat?.channel_plan?.slice().sort((a, b) => (b.budget || 0) - (a.budget || 0))[0];

    panel.innerHTML = `
      <div class="metric-row">
        <div class="metric-box">
          <span class="metric-label">${t('strategy_metric_budget', 'Total Budget')}</span>
          <span class="metric-value">${fmtMoney(totalBudget)}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('strategy_metric_channels', 'Channels')}</span>
          <span class="metric-value">${channelCount}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('strategy_metric_top', 'Top Channel')}</span>
          <span class="metric-value">${escapeHtml(top?.channel || '—')}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('strategy_metric_strategy_id', 'Strategy ID')}</span>
          <span class="metric-value tiny">${escapeHtml((strat?.strategy_id || event?.id || '—').slice(0, 14))}</span>
        </div>
      </div>

      ${strat
        ? renderOverviewBody(event, strat)
        : `<p class="muted">${t('strategy_no_strategy', 'No strategy yet — try the What-If sandbox or launch a campaign from Hub.')}</p>`}
    `;
    setStatus(strat ? t('strategy_status_ready', 'Decided') : t('metric_idle', 'Idle'));
  }
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('StrategyDecided', paint);
  return () => { try { unsub(); } catch {} };
}

function renderOverviewBody(event, strat) {
  // Conditionally render the cards that only one of the two backends emits.
  const cards = [];
  if (strat.reasoning) {
    cards.push(`
      <div class="panel-card">
        <header class="panel-card-head"><h3>${t('strategy_reasoning', 'AI Reasoning')}</h3></header>
        <div class="panel-card-body"><p>${escapeHtml(strat.reasoning)}</p></div>
      </div>
    `);
  }
  if (strat.audience) {
    cards.push(renderAudienceCard(strat.audience));
  }
  if (strat.schedule) {
    cards.push(renderScheduleCard(strat.schedule));
  }
  if (strat.bid_rationale) {
    cards.push(`
      <div class="panel-card">
        <header class="panel-card-head"><h3>${t('strategy_rationale', 'Bid Rationale')}</h3></header>
        <div class="panel-card-body"><code class="code-inline">${escapeHtml(strat.bid_rationale)}</code></div>
      </div>
    `);
  }
  return cards.join('') || `<p class="muted tiny">${t('strategy_minimal_strategy', 'This strategy has no extended cards (reasoning / audience / schedule).')}</p>`;
}

function renderAudienceCard(aud) {
  const rows = [
    ['type', aud.type],
    ['age', aud.age],
    ['interests', Array.isArray(aud.interests) ? aud.interests.join(', ') : null],
    ['geo', Array.isArray(aud.geo) ? aud.geo.join(', ') : aud.geo],
    ['lookalike', aud.lookalike],
    ['similarity', aud.similarity],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return `
    <div class="panel-card">
      <header class="panel-card-head"><h3>${t('strategy_audience', 'Audience')}</h3></header>
      <div class="panel-card-body">
        <div class="kv-grid">
          ${rows.map(([k, v]) => `
            <div><span class="kv-k">${escapeHtml(k)}</span><span class="kv-v">${escapeHtml(String(v))}</span></div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderScheduleCard(sch) {
  return `
    <div class="panel-card">
      <header class="panel-card-head"><h3>${t('strategy_schedule', 'Schedule')}</h3></header>
      <div class="panel-card-body">
        <div class="kv-grid">
          <div><span class="kv-k">timezone</span><span class="kv-v">${escapeHtml(sch.timezone || '—')}</span></div>
          <div><span class="kv-k">peak_hours</span><span class="kv-v">${(sch.peak_hours || []).join(', ')}</span></div>
          <div><span class="kv-k">pause_hours</span><span class="kv-v">${(sch.pause_hours || []).join(', ')}</span></div>
        </div>
      </div>
    </div>
  `;
}

// ── Tab: Channel Plan ─────────────────────────────────────────────
function renderChannelPlan(panel) {
  function paint() {
    const event = latestStrategyEvent();
    const strat = pickStrategy(event);
    if (!strat?.channel_plan?.length) {
      panel.innerHTML = `<div class="dag-empty"><p>${t('strategy_no_plan', 'No channel plan yet.')}</p></div>`;
      return;
    }
    const totalBudget = strat.channel_plan.reduce((s, c) => s + (Number(c.budget) || 0), 0) || 1;
    panel.innerHTML = `
      <table class="attr-table">
        <thead>
          <tr>
            <th>${t('strategy_col_channel', 'Channel')}</th>
            <th class="num">${t('strategy_col_budget', 'Budget')}</th>
            <th class="num">${t('strategy_col_share', 'Share')}</th>
            <th>${t('strategy_col_score', 'Score / Priority')}</th>
            <th>${t('strategy_col_bid', 'Bid Strategy')}</th>
            <th class="num">${t('strategy_col_target', 'Target / CTR Baseline')}</th>
          </tr>
        </thead>
        <tbody>
          ${strat.channel_plan.map(c => `
            <tr>
              <td><span class="channel-pill">${escapeHtml(c.channel)}</span></td>
              <td class="num">${fmtMoney(c.budget)}</td>
              <td class="num">${((Number(c.budget) || 0) / totalBudget * 100).toFixed(1)}%</td>
              <td>${c.score !== undefined ? `<span class="kv-v">${c.score}</span>` : `<span class="kv-v">${escapeHtml(c.priority || '—')}</span>`}</td>
              <td><code class="code-inline">${escapeHtml(c.bid_strategy || '—')}</code></td>
              <td class="num">${c.bid_target ?? c.ctr_baseline ?? '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('StrategyDecided', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: What-If (specialization) ─────────────────────────────────
function renderWhatIf(panel) {
  if (!whatIfState) whatIfState = defaultWhatIfState();
  const ctx = getCtx();
  const agent = ctx.orchestrator?.agents?.get?.('Strategy');
  if (!agent) {
    panel.innerHTML = `<p class="muted">${t('strategy_agent_unavailable', 'Strategy agent not available.')}</p>`;
    return;
  }

  function paint() {
    panel.innerHTML = `
      <div class="replan-banner">
        ${icon('sparkles', 'sm')}
        <span>${t('strategy_whatif_warning', 'Preview mode · Does not modify any campaign.')}</span>
      </div>
      <div class="whatif-layout">
        <form class="config-form" data-whatif-form>
          <div class="form-row">
            <label>${t('strategy_form_target', 'Target')}</label>
            <select class="modal-input" id="wi-target">
              ${TARGETS.map(t0 => `<option value="${t0}" ${t0 === whatIfState.target ? 'selected' : ''}>${t0}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>${t('strategy_form_budget', 'Total Budget')}</label>
            <input type="number" class="modal-input" id="wi-budget" min="100" step="100" value="${whatIfState.totalBudget}">
          </div>
          <div class="form-row">
            <label>${t('strategy_form_channels', 'Channels')}</label>
            <div class="chip-multiselect" id="wi-channels">
              ${KNOWN_CHANNELS.map(c => `
                <button type="button"
                        class="multi-chip ${whatIfState.channels.includes(c) ? 'active' : ''}"
                        data-channel="${c}">${c}</button>
              `).join('')}
            </div>
          </div>
          <div class="form-row-inline">
            <div>
              <label>${t('strategy_form_kpi_metric', 'KPI metric')}</label>
              <select class="modal-input" id="wi-kpi-metric">
                <option ${whatIfState.kpiMetric === 'ROAS' ? 'selected' : ''}>ROAS</option>
                <option ${whatIfState.kpiMetric === 'CTR' ? 'selected' : ''}>CTR</option>
                <option ${whatIfState.kpiMetric === 'CPA' ? 'selected' : ''}>CPA</option>
              </select>
            </div>
            <div>
              <label>${t('strategy_form_kpi_target', 'KPI target')}</label>
              <input type="number" class="modal-input" id="wi-kpi-target" step="0.1" value="${whatIfState.kpiTarget}">
            </div>
          </div>
          <div class="form-actions">
            <span class="muted tiny" data-whatif-status></span>
            <button type="button" class="btn btn-secondary" id="wi-copy" disabled>${t('planner_replan_copy', 'Copy as JSON')}</button>
            <button type="button" class="btn btn-primary"   id="wi-run">${t('strategy_form_run', 'Run preview')}</button>
          </div>
        </form>

        <div class="whatif-preview" data-whatif-preview>
          <p class="muted">${t('strategy_whatif_hint', 'Run preview to see channel allocation.')}</p>
        </div>
      </div>
    `;

    // Wire chip multi-select
    panel.querySelectorAll('[data-channel]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = btn.dataset.channel;
        const set = new Set(whatIfState.channels);
        set.has(ch) ? set.delete(ch) : set.add(ch);
        whatIfState.channels = [...set];
        btn.classList.toggle('active');
      });
    });

    panel.querySelector('#wi-run').addEventListener('click', runPreview);
    panel.querySelector('#wi-copy').addEventListener('click', copyJson);
  }

  async function runPreview() {
    whatIfState.target       = panel.querySelector('#wi-target').value;
    whatIfState.totalBudget  = Number(panel.querySelector('#wi-budget').value) || 10000;
    whatIfState.kpiMetric    = panel.querySelector('#wi-kpi-metric').value;
    whatIfState.kpiTarget    = Number(panel.querySelector('#wi-kpi-target').value) || 3.0;

    const statusEl = panel.querySelector('[data-whatif-status]');
    if (whatIfState.channels.length === 0) {
      statusEl.textContent = t('strategy_whatif_no_channel', 'Select at least one channel.');
      return;
    }

    statusEl.textContent = t('strategy_whatif_running', 'Computing…');
    try {
      const out = await agent.run({
        target:      whatIfState.target,
        channels:    whatIfState.channels,
        budget:      { total: whatIfState.totalBudget, currency: 'USD' },
        kpi:         { metric: whatIfState.kpiMetric, target: whatIfState.kpiTarget },
        campaign_id: 'whatif-preview',  // sentinel; not used downstream
      });
      lastWhatIfPlan = out;
      renderPreview(out);
      panel.querySelector('#wi-copy').disabled = false;
      statusEl.textContent = t('strategy_whatif_ok', 'Preview ready');
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  function renderPreview(out) {
    const totalBudget = (out.channel_plan || []).reduce((s, c) => s + (Number(c.budget) || 0), 0) || 1;
    const previewEl = panel.querySelector('[data-whatif-preview]');
    previewEl.innerHTML = `
      ${out.bid_rationale ? `<p class="muted tiny">${escapeHtml(out.bid_rationale)}</p>` : ''}
      <div class="whatif-channel-list">
        ${(out.channel_plan || []).map(c => {
          const pct = (Number(c.budget) || 0) / totalBudget * 100;
          return `
            <div class="whatif-channel">
              <div class="whatif-channel-head">
                <span class="channel-pill">${escapeHtml(c.channel)}</span>
                <span class="muted tiny">${escapeHtml(c.bid_strategy || '—')}</span>
                <span class="kv-v">${fmtMoney(c.budget)}</span>
              </div>
              <div class="whatif-bar">
                <div class="whatif-bar-fill" style="width:${pct}%; background:var(--agent-strategy)"></div>
              </div>
              <div class="whatif-channel-meta">
                <span class="muted tiny">score ${c.score ?? '—'}</span>
                <span class="muted tiny">${pct.toFixed(1)}%</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  async function copyJson() {
    if (!lastWhatIfPlan) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastWhatIfPlan, null, 2));
      panel.querySelector('[data-whatif-status]').textContent = t('planner_replan_copy_done', 'Copied');
    } catch {
      panel.querySelector('[data-whatif-status]').textContent = 'clipboard denied';
    }
  }

  paint();
}

// ── Tab: Runs ─────────────────────────────────────────────────────
function renderRuns(panel) {
  const events = strategyEvents().slice().reverse();
  panel.innerHTML = events.length
    ? `<ul class="runs-list">${events.map(renderRunRow).join('')}</ul>`
    : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`;
  panel.querySelectorAll('.run-row').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

function renderRunRow(event) {
  const strat = pickStrategy(event);
  const n = strat?.channel_plan?.length || 0;
  const tb = strat?.total_budget ?? strat?.channel_plan?.reduce((s, c) => s + (Number(c.budget) || 0), 0) ?? 0;
  return `
    <li class="run-row" data-id="${event.id}">
      <header class="run-row-head">
        <span class="run-row-time">${fmtTime(event.occurred_at)}</span>
        <span class="run-row-summary">
          ${n} channels · budget ${fmtMoney(tb)}
          · ${event.campaign_id?.slice(0, 8) || '—'}…
        </span>
        <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
        ${icon('chevron-down', 'sm')}
      </header>
      <div class="run-row-body">
        <pre>${escapeHtml(JSON.stringify(strat, null, 2))}</pre>
      </div>
    </li>
  `;
}

// ── Tab: Logs ─────────────────────────────────────────────────────
function renderLogs(panel) {
  function paint() {
    const events = strategyEvents();
    panel.innerHTML = `
      <div class="logs-view">
        ${events.length
          ? events.slice().reverse().map(e => {
              const s = pickStrategy(e);
              const channels = (s?.channel_plan || []).map(c => c.channel).join(', ') || '—';
              return `
                <div class="log-line">
                  <span class="log-time">${fmtTime(e.occurred_at)}</span>
                  <span class="log-type">${e.event_type}</span>
                  <span class="log-msg">${escapeHtml(channels)}</span>
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
  const unsub = ctx.eventBus.subscribe('StrategyDecided', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Page module ───────────────────────────────────────────────────
export default {
  titleKey: 'page_strategy_title',

  async mount(outlet, ctx) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    const requestedTab = ctx?.query?.tab;

    frame = createAgentFrame({
      agent,
      runLabelKey: 'strategy_form_run',
      runLabelFallback: 'What-If',
      runIconName: 'sparkles',
      onRun: () => frame?.renderTab('whatif'),
      defaultTabId: requestedTab || 'overview',
      tabs: [
        { id: 'overview', labelKey: 'agent_tab_overview',  label: 'Overview',     icon: 'activity',     render: renderOverview },
        { id: 'plan',     labelKey: 'strategy_tab_plan',   label: 'Channel Plan', icon: 'bar-chart',    render: renderChannelPlan },
        { id: 'whatif',   labelKey: 'strategy_tab_whatif', label: 'What-If',      icon: 'sparkles',     render: renderWhatIf },
        { id: 'runs',     labelKey: 'agent_tab_runs',      label: 'Runs',         icon: 'clock',        render: renderRuns },
        { id: 'logs',     labelKey: 'agent_tab_logs',      label: 'Logs',         icon: 'activity',     render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
    // Keep whatIfState across mounts so re-mount via i18n / back-nav doesn't
    // wipe the user's input. Only reset on full reload.
  },
};
