/*
 * Planner Agent Page — dedicated workbench with DAG viewer.
 * Spec: docs/frontend/06-planner-page-spec.md
 *
 * Data sources:
 *   - eventBus.history['PlanGenerated']           → Overview, Runs, Logs, DAG
 *   - orchestrator.campaigns                      → node status derivation
 *   - orchestrator.planner._selectTemplate(...)   → Templates tab (4 scenarios)
 *   - orchestrator.planner.createPlan(...)        → Re-plan sandbox (no write-back)
 *
 * Planner is one-shot (see spec §2); this page never subscribes to downstream
 * events like ReportGenerated / OptimizationApplied.
 */

import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID    = 'planner';
const AGENT_EVENT = 'PlanGenerated';

// Planner emits agentType with PascalCase; map to registry keys / routes.
const AGENT_TYPE_TO_ID = {
  Orchestrator: 'orchestrator',
  Planner:      'planner',
  Strategy:     'strategy',
  ContentGen:   'content-gen',
  Multimodal:   'multimodal',
  ChannelExec:  'channel-exec',
  Analysis:     'analysis',
  Optimizer:    'optimizer',
};

const SCENARIOS = ['NEW_PRODUCT', 'RETENTION', 'BRAND_AWARENESS', 'GROWTH_GENERAL'];
const SCENARIO_LABEL_KEY = {
  NEW_PRODUCT:     'planner_scenario_new_product',
  RETENTION:       'planner_scenario_retention',
  BRAND_AWARENESS: 'planner_scenario_brand',
  GROWTH_GENERAL:  'planner_scenario_growth',
};
const SCENARIO_DESC_KEY = {
  NEW_PRODUCT:     'planner_scenario_new_product_desc',
  RETENTION:       'planner_scenario_retention_desc',
  BRAND_AWARENESS: 'planner_scenario_brand_desc',
  GROWTH_GENERAL:  'planner_scenario_growth_desc',
};

// Module-level state — survives tab switches within the same mount.
let frame = null;
let prefilledScenario = null;  // set when Templates → Re-plan pre-fill
let lastPreviewPlan   = null;  // for Copy-as-JSON in Re-plan tab

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()     { return window.OAG || {}; }
function t(k, d)      { return i18n.t(k) || d; }
function formatTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function planEvents() {
  return (getCtx().eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);
}
function latestPlanEvent() {
  const list = planEvents();
  return list.length ? list[list.length - 1] : null;
}
function getPlanner() {
  return getCtx().orchestrator?.planner || null;
}
function parallelGroups(plan) {
  return [...new Set((plan?.tasks || []).map(t => t.parallel_group).filter(Boolean))];
}

// ── DAG layout (topological layering + SVG render) ───────────────
const NODE_W = 144;
const NODE_H = 60;
const H_GAP  = 56;   // horizontal gap between layers
const V_GAP  = 20;   // vertical gap between same-layer nodes
const PAD    = 24;

function layerize(tasks) {
  const assigned = new Set();
  const layers = [];
  let safety = tasks.length + 2;
  while (assigned.size < tasks.length && safety-- > 0) {
    const layer = tasks.filter(task =>
      !assigned.has(task.id) &&
      (task.dependencies || []).every(d => assigned.has(d))
    );
    if (!layer.length) break;  // dependency cycle — bail
    layers.push(layer);
    layer.forEach(t => assigned.add(t.id));
  }
  return layers;
}

function computeLayout(layers) {
  const positions = new Map();
  const maxLayerSize = Math.max(1, ...layers.map(l => l.length));
  const columnH = maxLayerSize * NODE_H + (maxLayerSize - 1) * V_GAP;
  layers.forEach((layer, layerIdx) => {
    const layerH = layer.length * NODE_H + (layer.length - 1) * V_GAP;
    const offsetY = (columnH - layerH) / 2;
    layer.forEach((task, nodeIdx) => {
      positions.set(task.id, {
        x: PAD + layerIdx * (NODE_W + H_GAP),
        y: PAD + offsetY + nodeIdx * (NODE_H + V_GAP),
        w: NODE_W,
        h: NODE_H,
      });
    });
  });
  const width  = PAD * 2 + layers.length * NODE_W + (layers.length - 1) * H_GAP;
  const height = PAD * 2 + columnH;
  return { positions, width, height };
}

// Ancestors of a task — used to mark nodes "done" when a later task is active.
function buildAncestorMap(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const cache = new Map();
  function climb(id) {
    if (cache.has(id)) return cache.get(id);
    const set = new Set();
    const task = byId.get(id);
    (task?.dependencies || []).forEach(d => {
      set.add(d);
      climb(d).forEach(x => set.add(x));
    });
    cache.set(id, set);
    return set;
  }
  tasks.forEach(t => climb(t.id));
  return cache;
}

// Returns fn(task) → 'pending' | 'running' | 'done'
function makeStatusResolver(plan, campaignId) {
  const campaign = getCtx().orchestrator?.campaigns?.get?.(campaignId);
  if (!campaign) return () => 'pending';
  if (/^LOOP_/.test(campaign.status || '')) return () => 'done';

  const active = new Set(campaign.active_tasks || []);
  const ancestors = buildAncestorMap(plan.tasks || []);
  const doneIds = new Set();
  active.forEach(aid => ancestors.get(aid)?.forEach(x => doneIds.add(x)));

  return (task) => {
    if (active.has(task.id)) return 'running';
    if (doneIds.has(task.id)) return 'done';
    // If status is MONITORING or similar post-execution state, mark all done.
    if (campaign.status === 'MONITORING' || campaign.status === 'COMPLETED') return 'done';
    return 'pending';
  };
}

function agentColor(agentType) {
  const id = AGENT_TYPE_TO_ID[agentType];
  return AGENTS[id]?.color || 'var(--text-tertiary)';
}
function agentIconName(agentType) {
  const id = AGENT_TYPE_TO_ID[agentType];
  return AGENTS[id]?.icon || 'dot';
}

function renderNodeSvg(task, pos, status) {
  const color = agentColor(task.agentType);
  const statusClass = `dag-node-${status}`;
  const targetRoute = AGENT_TYPE_TO_ID[task.agentType] ? `#/agents/${AGENT_TYPE_TO_ID[task.agentType]}` : null;
  const parallelTag = task.parallel_group
    ? `<text x="${pos.x + pos.w - 8}" y="${pos.y + 14}" text-anchor="end" class="dag-parallel-tag">∥ ${escapeHtml(task.parallel_group)}</text>`
    : '';
  const badge = status === 'done'
    ? `<text x="${pos.x + pos.w - 10}" y="${pos.y + pos.h - 10}" text-anchor="end" class="dag-badge-done">✓</text>`
    : status === 'error'
      ? `<text x="${pos.x + pos.w - 10}" y="${pos.y + pos.h - 10}" text-anchor="end" class="dag-badge-err">✕</text>`
      : '';
  const tooltip = escapeHtml([
    `task: ${task.id}`,
    `agent: ${task.agentType}`,
    task.dependencies?.length ? `deps: ${task.dependencies.join(', ')}` : 'deps: —',
    task.parallel_group ? `parallel: ${task.parallel_group}` : null,
  ].filter(Boolean).join('\n'));

  // Whole node is a link when we know where to go.
  const open  = targetRoute ? `<a href="${targetRoute}" aria-label="Open ${task.agentType} agent">` : '<g>';
  const close = targetRoute ? `</a>` : '</g>';

  return `
    ${open}
      <g class="dag-node ${statusClass}" data-task="${escapeHtml(task.id)}" transform="translate(0,0)">
        <title>${tooltip}</title>
        <rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}"
              rx="8" ry="8"
              class="dag-node-rect"
              style="stroke:${color}"></rect>
        <rect x="${pos.x}" y="${pos.y}" width="4" height="${pos.h}"
              rx="2" ry="2"
              style="fill:${color}"></rect>
        <text x="${pos.x + 14}" y="${pos.y + 22}" class="dag-node-id">${escapeHtml(task.id)}</text>
        <text x="${pos.x + 14}" y="${pos.y + 42}" class="dag-node-type" style="fill:${color}">${escapeHtml(task.agentType)}</text>
        ${parallelTag}
        ${badge}
      </g>
    ${close}
  `;
}

function renderEdgeSvg(from, to, status) {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(30, (x2 - x1) / 2);
  const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  return `<path d="${path}" class="dag-edge ${status === 'done' ? 'done' : ''}" aria-hidden="true"/>`;
}

function renderParallelFrames(plan, positions) {
  const groups = new Map();
  (plan.tasks || []).forEach(task => {
    if (!task.parallel_group) return;
    if (!groups.has(task.parallel_group)) groups.set(task.parallel_group, []);
    groups.get(task.parallel_group).push(task);
  });
  const frames = [];
  for (const [name, members] of groups) {
    if (members.length < 2) continue;
    const rects = members.map(m => positions.get(m.id)).filter(Boolean);
    if (!rects.length) continue;
    const minX = Math.min(...rects.map(r => r.x)) - 8;
    const minY = Math.min(...rects.map(r => r.y)) - 14;
    const maxX = Math.max(...rects.map(r => r.x + r.w)) + 8;
    const maxY = Math.max(...rects.map(r => r.y + r.h)) + 8;
    frames.push(`
      <g class="dag-parallel-frame" aria-hidden="true">
        <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}"
              rx="10" ry="10"></rect>
        <text x="${minX + 8}" y="${minY + 12}">∥ ${escapeHtml(name)}</text>
      </g>
    `);
  }
  return frames.join('');
}

function renderDagSvg(plan, opts = {}) {
  const tasks = plan?.tasks || [];
  if (!tasks.length) return '';
  const layers = layerize(tasks);
  if (!layers.length) return `<p class="muted">${t('planner_dag_cycle', 'Dependency cycle detected; nothing to render.')}</p>`;

  const { positions, width, height } = computeLayout(layers);
  const resolveStatus = opts.campaignId
    ? makeStatusResolver(plan, opts.campaignId)
    : () => 'pending';

  const edges = [];
  for (const task of tasks) {
    const toPos = positions.get(task.id);
    if (!toPos) continue;
    const statusTo = resolveStatus(task);
    for (const depId of (task.dependencies || [])) {
      const fromPos = positions.get(depId);
      if (!fromPos) continue;
      edges.push(renderEdgeSvg(fromPos, toPos, statusTo));
    }
  }
  const nodes = tasks.map(task => renderNodeSvg(task, positions.get(task.id), resolveStatus(task)));
  const frames = renderParallelFrames(plan, positions);

  return `
    <svg class="dag-svg"
         viewBox="0 0 ${width} ${height}"
         preserveAspectRatio="xMinYMin meet"
         role="img"
         aria-label="${t('planner_dag_aria', 'Task dependency graph')}">
      ${frames}
      ${edges.join('')}
      ${nodes.join('')}
    </svg>
  `;
}

function renderDagLegend() {
  return `
    <div class="dag-legend" aria-hidden="true">
      <span><i class="dot pending"></i>${t('planner_legend_pending', 'pending')}</span>
      <span><i class="dot running"></i>${t('planner_legend_running', 'running')}</span>
      <span><i class="dot done"></i>${t('planner_legend_done', 'done')}</span>
      <span><i class="dot error"></i>${t('planner_legend_error', 'error')}</span>
    </div>
  `;
}

function renderEmptyDag() {
  return `
    <div class="dag-empty">
      <p>${t('planner_no_plan', 'No plan yet — launch a campaign from Hub, or try a template in the Re-plan tab.')}</p>
      <div class="dag-empty-actions">
        <a class="btn btn-secondary" href="#/">${t('btn_back_hub', 'Back to Hub')}</a>
        <button class="btn btn-primary" data-planner-goto="replan">${t('planner_btn_replan', 'Re-plan')}</button>
      </div>
    </div>
  `;
}

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  const latest = latestPlanEvent();
  const plan = latest?.payload?.plan;
  const runs = planEvents().length;
  const pgroups = plan ? parallelGroups(plan) : [];
  const scenario = plan?.scenario || '—';

  panel.innerHTML = `
    <div class="metric-row">
      <div class="metric-box">
        <span class="metric-label">${t('planner_metric_scenario', 'Scenario')}</span>
        <span class="metric-value">${escapeHtml(scenario)}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('planner_metric_tasks', 'Tasks')}</span>
        <span class="metric-value">${plan?.tasks?.length ?? '—'}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('planner_metric_parallel', 'Parallel groups')}</span>
        <span class="metric-value">${pgroups.length}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('planner_metric_runs', 'Runs')}</span>
        <span class="metric-value">${runs}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('planner_metric_last', 'Last Plan')}</span>
        <span class="metric-value">${formatTime(latest?.occurred_at)}</span>
      </div>
    </div>

    <div class="panel-card">
      <header class="panel-card-head">
        <h3>${t('planner_last_summary', 'Last Plan Summary')}</h3>
      </header>
      <div class="panel-card-body">
        ${plan ? renderPlanSummary(latest) : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`}
      </div>
    </div>
  `;

  setStatus(scenario === '—' ? t('metric_idle', 'Idle') : scenario);
}

function renderPlanSummary(event) {
  const plan = event.payload?.plan || {};
  const goal = plan.goal || '—';
  return `
    <div class="kv-grid">
      <div><span class="kv-k">${t('planner_summary_goal', 'Goal')}</span><span class="kv-v">${escapeHtml(goal.length > 60 ? goal.slice(0, 60) + '…' : goal)}</span></div>
      <div><span class="kv-k">${t('planner_metric_scenario', 'Scenario')}</span><span class="kv-v">${escapeHtml(plan.scenario || '—')}</span></div>
      <div><span class="kv-k">${t('planner_metric_tasks', 'Tasks')}</span><span class="kv-v">${plan.tasks?.length ?? '—'}</span></div>
      <div><span class="kv-k">${t('agent_campaign_id', 'Campaign')}</span><span class="kv-v">${event.campaign_id?.slice(0, 8) || '—'}…</span></div>
      <div><span class="kv-k">${t('agent_time', 'Time')}</span><span class="kv-v">${formatTime(event.occurred_at)}</span></div>
    </div>
    <ul class="action-chip-list">
      ${(plan.tasks || []).map(task => `
        <li class="action-chip" style="--chip-color:${agentColor(task.agentType)}">
          <span class="chip-type">${escapeHtml(task.id)}</span>
          <code>${escapeHtml(task.agentType)}${task.parallel_group ? ' ∥ ' + task.parallel_group : ''}</code>
        </li>
      `).join('')}
    </ul>
  `;
}

// ── Tab: DAG ───────────────────────────────────────────────────────
function renderDag(panel) {
  function paint() {
    const latest = latestPlanEvent();
    if (!latest) {
      panel.innerHTML = renderEmptyDag();
      panel.querySelector('[data-planner-goto="replan"]')
        ?.addEventListener('click', () => frame?.renderTab('replan'));
      return;
    }
    const plan = latest.payload.plan;
    panel.innerHTML = `
      <div class="dag-header">
        <div>
          <span class="scenario-chip" style="background:${agentColor('Planner')}">${escapeHtml(plan.scenario || '—')}</span>
          <span class="muted tiny"> · ${plan.tasks.length} ${t('planner_metric_tasks', 'Tasks').toLowerCase()} · ${parallelGroups(plan).length} ${t('planner_metric_parallel', 'parallel').toLowerCase()}</span>
        </div>
        ${renderDagLegend()}
      </div>
      <div class="dag-viewport">
        ${renderDagSvg(plan, { campaignId: latest.campaign_id })}
      </div>
    `;
  }
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe(AGENT_EVENT, paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Templates ────────────────────────────────────────────────
function renderTemplates(panel) {
  const planner = getPlanner();
  if (!planner) {
    panel.innerHTML = `<p class="muted">${t('planner_unavailable', 'Planner is not available.')}</p>`;
    return;
  }
  panel.innerHTML = `
    <p class="muted">${t('planner_templates_note', 'Four built-in scenario templates. Click a card to pre-fill the Re-plan sandbox.')}</p>
    <div class="scenario-grid">
      ${SCENARIOS.map(scenario => {
        const tasks = planner._selectTemplate(scenario, null);
        const pgroups = [...new Set(tasks.map(t => t.parallel_group).filter(Boolean))];
        return `
          <article class="scenario-card" data-scenario="${scenario}">
            <header>
              <h4>${t(SCENARIO_LABEL_KEY[scenario], scenario)}</h4>
              <span class="scenario-tag">${tasks.length} ${t('planner_metric_tasks', 'tasks').toLowerCase()} · ${pgroups.length} ∥</span>
            </header>
            <p class="muted tiny">${t(SCENARIO_DESC_KEY[scenario], '')}</p>
            <ol class="scenario-task-list">
              ${tasks.map(task => `
                <li style="--chip-color:${agentColor(task.agentType)}">
                  <span class="chip-type">${escapeHtml(task.id)}</span>
                  <code>${escapeHtml(task.agentType)}${task.parallel_group ? ' ∥ ' + task.parallel_group : ''}</code>
                </li>
              `).join('')}
            </ol>
            <footer>
              <button class="btn btn-secondary" data-use-scenario="${scenario}">${t('planner_template_cta', 'Use in Re-plan')}</button>
            </footer>
          </article>
        `;
      }).join('')}
    </div>
  `;

  const handlers = [];
  panel.querySelectorAll('[data-use-scenario]').forEach(btn => {
    const onClick = () => {
      prefilledScenario = btn.dataset.useScenario;
      frame?.renderTab('replan');
    };
    btn.addEventListener('click', onClick);
    handlers.push({ el: btn, onClick });
  });
  return () => handlers.forEach(({ el, onClick }) => el.removeEventListener('click', onClick));
}

// ── Tab: Re-plan (sandbox) ────────────────────────────────────────
const SCENARIO_GOAL_HINT = {
  NEW_PRODUCT:     '冷启动新品发布 launch',
  RETENTION:       '老用户复购 retention',
  BRAND_AWARENESS: '品牌曝光 brand awareness',
  GROWTH_GENERAL:  '通用增长 growth',
};

function renderReplan(panel) {
  const planner = getPlanner();
  if (!planner) {
    panel.innerHTML = `<p class="muted">${t('planner_unavailable', 'Planner is not available.')}</p>`;
    return;
  }
  const lastEvent = latestPlanEvent();
  const defaultGoal = prefilledScenario
    ? SCENARIO_GOAL_HINT[prefilledScenario]
    : (lastEvent?.payload?.plan?.goal || '');
  prefilledScenario = null;

  panel.innerHTML = `
    <div class="replan-banner">
      ${icon('sparkles', 'sm')}
      <span>${t('planner_replan_warning', 'Preview mode · No execution, no campaign changes.')}</span>
    </div>
    <form class="config-form" data-replan-form>
      <div class="form-row">
        <label>${t('planner_replan_goal', 'Goal')}</label>
        <input type="text" class="modal-input" id="rp-goal" value="${escapeHtml(defaultGoal)}" placeholder="e.g. launch a new eco water bottle in US">
      </div>
      <div class="form-row-inline">
        <div>
          <label>${t('planner_replan_budget', 'Budget (USD)')}</label>
          <input type="number" class="modal-input" id="rp-budget" value="10000" min="100" step="100">
        </div>
        <div>
          <label>${t('planner_replan_kpi_metric', 'KPI metric')}</label>
          <select class="modal-input" id="rp-kpi-metric">
            <option value="ROAS">ROAS</option>
            <option value="CVR">CVR</option>
            <option value="CTR">CTR</option>
            <option value="Reach">Reach</option>
          </select>
        </div>
        <div>
          <label>${t('planner_replan_kpi_target', 'KPI target')}</label>
          <input type="number" class="modal-input" id="rp-kpi-target" value="3.0" step="0.1">
        </div>
      </div>
      <div class="form-row-inline">
        <div>
          <label>${t('planner_replan_channels', 'Channels (comma separated)')}</label>
          <input type="text" class="modal-input" id="rp-channels" value="tiktok, meta">
        </div>
        <div>
          <label>${t('planner_replan_region', 'Region')}</label>
          <select class="modal-input" id="rp-region">
            <option value="US">US</option>
            <option value="CN">CN</option>
            <option value="EU">EU</option>
            <option value="SEA">SEA</option>
            <option value="Global">Global</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <span class="muted tiny" data-replan-status></span>
        <button type="button" class="btn btn-secondary" id="rp-copy" disabled>
          ${icon('clock', 'sm')}
          <span>${t('planner_replan_copy', 'Copy as JSON')}</span>
        </button>
        <button type="button" class="btn btn-secondary" id="rp-apply" disabled
                title="${t('planner_replan_apply_disabled', 'Optimizer callback not wired (v0.0.3)')}">
          ${t('planner_replan_apply', 'Apply to current campaign')}
        </button>
        <button type="submit" class="btn btn-primary" id="rp-generate">
          ${icon('sparkles', 'sm')}
          <span>${t('planner_replan_generate', 'Generate preview')}</span>
        </button>
      </div>
    </form>
    <div class="panel-card" data-replan-preview hidden>
      <header class="panel-card-head">
        <h3>${t('planner_replan_preview', 'Preview plan')}</h3>
      </header>
      <div class="panel-card-body">
        ${renderDagLegend()}
        <div class="dag-viewport" data-replan-dag></div>
      </div>
    </div>
  `;

  const form = panel.querySelector('[data-replan-form]');
  const previewBox = panel.querySelector('[data-replan-preview]');
  const dagBox = panel.querySelector('[data-replan-dag]');
  const statusEl = panel.querySelector('[data-replan-status]');
  const copyBtn = panel.querySelector('#rp-copy');

  const onSubmit = async (e) => {
    e.preventDefault();
    const input = {
      goal:        panel.querySelector('#rp-goal').value.trim() || 'growth campaign',
      budget:      { total: Number(panel.querySelector('#rp-budget').value) || 10000, currency: 'USD' },
      kpi:         {
        metric: panel.querySelector('#rp-kpi-metric').value,
        target: Number(panel.querySelector('#rp-kpi-target').value) || 3.0,
      },
      constraints: {
        channels: panel.querySelector('#rp-channels').value.split(',').map(s => s.trim()).filter(Boolean),
        region:   panel.querySelector('#rp-region').value,
      },
      history: null,
    };
    try {
      const plan = await planner.createPlan(input);
      lastPreviewPlan = plan;
      previewBox.hidden = false;
      dagBox.innerHTML = renderDagSvg(plan);  // no campaignId → all pending
      statusEl.textContent = `${t('planner_replan_ok', 'Preview generated')} · ${plan.scenario} · ${plan.tasks.length} tasks`;
      copyBtn.disabled = false;
    } catch (err) {
      statusEl.textContent = err.message;
    }
  };
  form.addEventListener('submit', onSubmit);

  const onCopy = async () => {
    if (!lastPreviewPlan) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastPreviewPlan, null, 2));
      statusEl.textContent = t('planner_replan_copy_done', 'Copied');
    } catch {
      statusEl.textContent = 'clipboard denied';
    }
  };
  copyBtn.addEventListener('click', onCopy);

  return () => {
    form.removeEventListener('submit', onSubmit);
    copyBtn.removeEventListener('click', onCopy);
  };
}

// ── Tab: Runs ─────────────────────────────────────────────────────
function renderRuns(panel) {
  const events = planEvents().slice().reverse();
  panel.innerHTML = events.length
    ? `<ul class="runs-list">${events.map(renderRunRow).join('')}</ul>`
    : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`;

  panel.querySelectorAll('.run-row').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

function renderRunRow(event) {
  const plan = event.payload?.plan || {};
  return `
    <li class="run-row" data-id="${event.id}">
      <header class="run-row-head">
        <span class="run-row-time">${formatTime(event.occurred_at)}</span>
        <span class="run-row-summary">
          ${plan.tasks?.length ?? 0} tasks · ${escapeHtml(plan.scenario || '—')}
          · ${event.campaign_id?.slice(0, 8) || '—'}…
        </span>
        <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
        ${icon('chevron-down', 'sm')}
      </header>
      <div class="run-row-body">
        <pre>${escapeHtml(JSON.stringify(plan, null, 2))}</pre>
      </div>
    </li>
  `;
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
    const events = planEvents();
    panel.innerHTML = `
      <p class="muted tiny">${t('planner_logs_note', 'Planner only emits events at campaign launch. For the global event stream, return to Hub.')}</p>
      <div class="logs-view">
        ${events.length
          ? events.slice().reverse().map(e => `
            <div class="log-line">
              <span class="log-time">${formatTime(e.occurred_at)}</span>
              <span class="log-type">${e.event_type}</span>
              <span class="log-msg">${escapeHtml(e.payload?.plan?.scenario || '—')} · ${e.payload?.plan?.tasks?.length ?? 0} tasks</span>
            </div>
          `).join('')
          : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`}
      </div>
    `;
  }
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe(AGENT_EVENT, paint);
  return () => { try { unsub(); } catch {} };
}

// ── Page module ───────────────────────────────────────────────────
export default {
  titleKey: 'page_planner_title',

  async mount(outlet, ctx) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    prefilledScenario = null;
    lastPreviewPlan = null;

    // Allow ?tab=<id> in the URL to override the page default.
    // Forwards browser-back / deep-link to the correct tab.
    const requestedTab = ctx?.query?.tab;

    frame = createAgentFrame({
      agent,
      runLabelKey: 'planner_btn_replan',
      runLabelFallback: 'Re-plan',
      runIconName: 'sparkles',
      onRun: () => frame?.renderTab('replan'),
      defaultTabId: requestedTab || 'dag',
      tabs: [
        { id: 'overview',  labelKey: 'agent_tab_overview',     label: 'Overview',  icon: 'activity', render: renderOverview },
        { id: 'dag',       labelKey: 'planner_tab_dag',        label: 'DAG',       icon: 'network',  render: renderDag },
        { id: 'templates', labelKey: 'planner_tab_templates',  label: 'Templates', icon: 'map',      render: renderTemplates },
        { id: 'replan',    labelKey: 'planner_tab_replan',     label: 'Re-plan',   icon: 'sparkles', render: renderReplan },
        { id: 'runs',      labelKey: 'agent_tab_runs',         label: 'Runs',      icon: 'clock',    render: renderRuns },
        { id: 'logs',      labelKey: 'agent_tab_logs',         label: 'Logs',      icon: 'activity', render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
    prefilledScenario = null;
    lastPreviewPlan = null;
  },
};
