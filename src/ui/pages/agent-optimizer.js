/*
 * Optimizer Agent Page — dedicated workbench.
 * Spec: docs/frontend/05-agent-page-template.md  (§3 tabs, §4 Rules Inspector)
 *
 * Data sources:
 *   - eventBus.history['OptimizationApplied']    → Runs, Logs
 *   - ruleEngine.rules                            → Rules Inspector
 *   - ruleEngine.cooldownTracker                  → last-fired display
 *
 * Optimizer is rule-backed, so the "Prompt" tab shows the rule DSL overview.
 */

import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID    = 'optimizer';
const AGENT_EVENT = 'OptimizationApplied';

function getCtx() { return window.OAG || {}; }
function t(k, d) { return i18n.t(k) || d; }
function formatTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—';
}
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function optEvents() {
  const ctx = getCtx();
  return (ctx.eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);
}
function getRuleEngine() {
  // The Optimizer agent holds its own RuleEngine instance; the global
  // ruleEngine on window.OAG is a separate copy used by review gates.
  // Prefer the agent's engine so Rules Inspector matches real optimizer state.
  const ctx = getCtx();
  const agent = ctx.orchestrator?.agents?.get?.('Optimizer');
  return agent?.ruleEngine || ctx.ruleEngine || null;
}

// ── Tab: Overview ──────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  const events = optEvents();
  const last   = events[events.length - 1];
  const engine = getRuleEngine();
  const rules  = engine?.rules || [];
  const totalActions = events.reduce((s, e) => s + (e.payload?.actions?.length || 0), 0);

  panel.innerHTML = `
    <div class="metric-row">
      <div class="metric-box">
        <span class="metric-label">${t('metric_state', 'State')}</span>
        <span class="metric-value">${last ? t('status_optimizing', 'Optimizing') : t('metric_idle', 'Idle')}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('opt_metric_rules', 'Active Rules')}</span>
        <span class="metric-value">${rules.filter(r => r.enabled).length}/${rules.length}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('opt_metric_actions', 'Actions Applied')}</span>
        <span class="metric-value">${totalActions}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('metric_cycle', 'Cycle')}</span>
        <span class="metric-value">${last?.payload?.loop_count ?? '—'}</span>
      </div>
    </div>

    <div class="panel-card">
      <header class="panel-card-head">
        <h3>${t('agent_last_summary', 'Last Run Summary')}</h3>
      </header>
      <div class="panel-card-body">
        ${last ? renderOptSummary(last) : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`}
      </div>
    </div>
  `;
  setStatus(last ? t('status_optimizing', 'Optimizing') : t('metric_idle', 'Idle'));
}

function renderOptSummary(event) {
  const actions = event.payload?.actions || [];
  return `
    <div class="kv-grid">
      <div><span class="kv-k">${t('agent_campaign_id', 'Campaign')}</span><span class="kv-v">${event.campaign_id?.slice(0, 8) || '—'}…</span></div>
      <div><span class="kv-k">${t('opt_kv_actions', 'Actions')}</span><span class="kv-v">${actions.length}</span></div>
      <div><span class="kv-k">${t('metric_cycle', 'Cycle')}</span><span class="kv-v">${event.payload?.loop_count ?? '—'}</span></div>
      <div><span class="kv-k">${t('agent_time', 'Time')}</span><span class="kv-v">${formatTime(event.occurred_at)}</span></div>
    </div>
    <ul class="action-chip-list">
      ${actions.map(a => `<li class="action-chip"><span class="chip-type">${escapeHtml(a.type)}</span>${a.params ? `<code>${escapeHtml(JSON.stringify(a.params))}</code>` : ''}</li>`).join('')}
    </ul>
  `;
}

// ── Tab: Rules Inspector (specialization) ──────────────────────────
function renderRules(panel) {
  const engine = getRuleEngine();
  if (!engine) {
    panel.innerHTML = `<p class="muted">${t('opt_engine_unavailable', 'Rule engine unavailable.')}</p>`;
    return;
  }
  const rules = [...engine.rules].sort((a, b) => a.priority - b.priority);
  panel.innerHTML = `
    <div class="rules-grid">
      ${rules.map(r => renderRuleCard(r, engine)).join('')}
    </div>
  `;

  const handlers = [];
  panel.querySelectorAll('[data-rule-toggle]').forEach(cb => {
    const id = cb.dataset.ruleToggle;
    const onChange = () => {
      const rule = engine.rules.find(x => x.id === id);
      if (rule) rule.enabled = cb.checked;
      renderRules(panel);
    };
    cb.addEventListener('change', onChange);
    handlers.push({ el: cb, onChange });
  });
  return () => handlers.forEach(({ el, onChange }) => el.removeEventListener('change', onChange));
}

function renderRuleCard(rule, engine) {
  const cooldownEntries = [...(engine.cooldownTracker?.entries() || [])]
    .filter(([k]) => k.endsWith(':' + rule.id));
  const lastFire = cooldownEntries.length
    ? Math.max(...cooldownEntries.map(([, ts]) => ts))
    : null;

  return `
    <article class="rule-card ${rule.enabled ? '' : 'disabled'}">
      <header class="rule-card-head">
        <span class="rule-id">${rule.id}</span>
        <h4>${escapeHtml(rule.name)}</h4>
        <label class="toggle">
          <input type="checkbox" data-rule-toggle="${rule.id}" ${rule.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </header>
      <div class="rule-card-body">
        <div class="rule-meta">
          <span>${t('opt_rule_priority', 'Priority')} <b>${rule.priority}</b></span>
          <span>${t('opt_rule_cooldown', 'Cooldown')} <b>${Math.round(rule.cooldown_ms / 60000)}m</b></span>
          <span>${t('opt_rule_last_fire', 'Last fired')} <b>${lastFire ? formatTime(new Date(lastFire).toISOString()) : '—'}</b></span>
        </div>
        <div class="rule-condition">
          <span class="rule-section-label">${t('opt_rule_condition', 'Condition')}</span>
          <code>${escapeHtml(describeCondition(rule.condition))}</code>
        </div>
        <div class="rule-action">
          <span class="rule-section-label">${t('opt_rule_action', 'Action')}</span>
          <code>${escapeHtml(rule.action.type)}${rule.action.params ? ' ' + JSON.stringify(rule.action.params) : ''}</code>
        </div>
      </div>
    </article>
  `;
}

function describeCondition(cond) {
  if (!cond) return '';
  if ('field' in cond) return `${cond.field} ${cond.op} ${JSON.stringify(cond.value)}`;
  const parts = (cond.children || []).map(describeCondition);
  if (cond.operator === 'NOT') return `NOT(${parts[0]})`;
  return parts.join(` ${cond.operator} `);
}

// ── Tab: Config ────────────────────────────────────────────────────
function renderConfig(panel) {
  const engine = getRuleEngine();
  if (!engine) { panel.innerHTML = `<p class="muted">${t('opt_engine_unavailable', 'Rule engine unavailable.')}</p>`; return; }

  panel.innerHTML = `
    <div class="config-form">
      <p class="muted">${t('opt_config_note', 'Fine-grained rule tuning lives in Rules Inspector. Global thresholds below are local-only for now.')}</p>
      <div class="form-row">
        <label>${t('opt_cfg_roas_floor', 'ROAS floor (shrink budget below)')}</label>
        <input type="number" step="0.1" class="modal-input" id="opt-cfg-roas-floor" value="2.0">
      </div>
      <div class="form-row">
        <label>${t('opt_cfg_ab_conf', 'A/B winner confidence required')}</label>
        <input type="number" step="0.01" min="0.5" max="1" class="modal-input" id="opt-cfg-ab-conf" value="0.95">
      </div>
      <div class="form-row">
        <label>${t('opt_cfg_alert_cpm', 'Alert on CPM surge (%)')}</label>
        <input type="number" step="0.05" class="modal-input" id="opt-cfg-alert-cpm" value="0.5">
      </div>
      <div class="form-actions">
        <span class="muted tiny">${t('cfg_local_note', 'Saved locally for now — backend sync coming soon.')}</span>
        <button class="btn btn-primary" id="opt-cfg-save">${t('btn_save', 'Save')}</button>
      </div>
    </div>
  `;

  const onSave = () => flashToast(panel, t('cfg_saved', 'Saved'));
  panel.querySelector('#opt-cfg-save').addEventListener('click', onSave);
  return () => panel.querySelector('#opt-cfg-save')?.removeEventListener('click', onSave);
}

function flashToast(panel, msg) {
  const el = document.createElement('div');
  el.className = 'inline-toast';
  el.textContent = msg;
  panel.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ── Tab: Runs ──────────────────────────────────────────────────────
function renderRuns(panel) {
  const events = optEvents().slice().reverse();
  panel.innerHTML = events.length
    ? `<ul class="runs-list">${events.map(renderRunRow).join('')}</ul>`
    : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`;

  panel.querySelectorAll('.run-row').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

function renderRunRow(event) {
  const actions = event.payload?.actions || [];
  return `
    <li class="run-row" data-id="${event.id}">
      <header class="run-row-head">
        <span class="run-row-time">${formatTime(event.occurred_at)}</span>
        <span class="run-row-summary">${actions.length} actions · loop #${event.payload?.loop_count ?? '—'}</span>
        <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
        ${icon('chevron-down', 'sm')}
      </header>
      <div class="run-row-body">
        <pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
      </div>
    </li>
  `;
}

// ── Tab: DSL (replaces Prompt for rule-backed agent) ───────────────
function renderDsl(panel) {
  panel.innerHTML = `
    <div class="prompt-editor">
      <p class="muted">${t('opt_dsl_note', 'Optimizer is rule-driven — below is the current rule DSL for reference. Editing is read-only in v0.0.2.')}</p>
      <pre class="code-block">${escapeHtml(`condition: {
  operator: 'AND' | 'OR' | 'NOT',
  children: [ Predicate | Condition ]
}
predicate: {
  field: 'metrics.roas' | 'ab_test.winner_confidence' | ...,
  op: '>' | '<' | '>=' | '<=' | '==' | 'IN' | 'NOT_IN',
  value: number | boolean | string | array
}
action: {
  type: 'PAUSE_VARIANT' | 'TRIGGER_REWRITE' | 'REALLOCATE_BUDGET' | 'SCALE_BUDGET' | 'ALERT_HUMAN',
  params: { ... }
}`)}</pre>
    </div>
  `;
}

// ── Tab: Logs ──────────────────────────────────────────────────────
function renderLogs(panel) {
  const ctx = getCtx();
  const history = (ctx.eventBus?.history || []).filter(e =>
    e.event_type === AGENT_EVENT || e.event_type === 'RuleFired'
  );
  panel.innerHTML = `
    <div class="logs-view">
      ${history.length
        ? history.slice().reverse().map(e => `
          <div class="log-line">
            <span class="log-time">${formatTime(e.occurred_at)}</span>
            <span class="log-type">${e.event_type}</span>
            <span class="log-msg">${(e.payload?.actions || []).map(a => a.type).join(', ') || '—'}</span>
          </div>
        `).join('')
        : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`
      }
    </div>
  `;

  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe(AGENT_EVENT, () => renderLogs(panel));
  return () => { try { unsub(); } catch {} };
}

// ── Page module ────────────────────────────────────────────────────
let frame = null;

export default {
  titleKey: 'page_agent_placeholder_title',

  async mount(outlet) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    frame = createAgentFrame({
      agent,
      tabs: [
        { id: 'overview', labelKey: 'agent_tab_overview', label: 'Overview', icon: 'activity',   render: renderOverview },
        { id: 'rules',    labelKey: 'agent_tab_rules',    label: 'Rules',    icon: 'settings',   render: renderRules },
        { id: 'config',   labelKey: 'agent_tab_config',   label: 'Config',   icon: 'settings',   render: renderConfig },
        { id: 'runs',     labelKey: 'agent_tab_runs',     label: 'Runs',     icon: 'clock',      render: renderRuns },
        { id: 'dsl',      labelKey: 'agent_tab_dsl',      label: 'DSL',      icon: 'pen-line',   render: renderDsl },
        { id: 'logs',     labelKey: 'agent_tab_logs',     label: 'Logs',     icon: 'activity',   render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
  },
};
