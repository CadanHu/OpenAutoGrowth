/*
 * Hub Page — /
 * The global orchestration view: hero, campaign status strip, DAG canvas,
 * agent summary grid, activity log.
 *
 * See: docs/frontend/04-hub-page-spec.md
 */

import { i18n }            from '../../i18n/index.js';
import { globalEventBus }  from '../../core/EventBus.js';
import { wsBroadcaster }   from '../../api/websocket.js';
import { icon }            from '../icons.js';
import { router }          from '../router.js';
import { AGENTS, AGENT_ORDER } from '../agent-registry.js';

// Singleton references are resolved lazily via window.OAG (set by main.js
// bootstrap). This avoids a circular import between the system wiring and
// the pages it serves.
function getCtx() {
  return window.OAG || {};
}

// ── Pipeline state map (preserves existing DAG semantics) ───────────
const PRODUCTION_EDGES = ['edge-2-top', 'edge-2-mid', 'edge-2-bot'];
const REVIEW_EDGES = ['edge-3-top', 'edge-3-mid', 'edge-3-bot'];

const PIPELINE_STATE = {
  IDLE:       { nodes: [], edges: [] },
  PLANNING:   { nodes: ['node-orchestrator', 'node-planner'], edges: ['edge-1'] },
  STRATEGY:   { nodes: ['node-orchestrator','node-planner','node-strategy'], edges: ['edge-1', ...PRODUCTION_EDGES] },
  CONTENT_GEN:{ nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen'], edges: ['edge-1', ...PRODUCTION_EDGES] },
  MULTIMODAL: { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal'], edges: ['edge-1', ...PRODUCTION_EDGES] },
  PENDING_REVIEW: { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal','node-reviewer'], edges: ['edge-1', ...PRODUCTION_EDGES, ...REVIEW_EDGES] },
  EXECUTING:  { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal','node-reviewer','node-channelexec'], edges: ['edge-1', ...PRODUCTION_EDGES, ...REVIEW_EDGES, 'edge-4'] },
  DEPLOYED:   { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal','node-reviewer','node-channelexec'], edges: ['edge-1', ...PRODUCTION_EDGES, ...REVIEW_EDGES, 'edge-4'] },
  ANALYZING:  { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal','node-reviewer','node-channelexec','node-analysis'], edges: ['edge-1', ...PRODUCTION_EDGES, ...REVIEW_EDGES, 'edge-4', 'edge-5'] },
  OPTIMIZING: { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal','node-reviewer','node-channelexec','node-analysis','node-optimizer'], edges: ['edge-1', ...PRODUCTION_EDGES, ...REVIEW_EDGES, 'edge-4', 'edge-5', 'edge-6'] },
  COMPLETED:  { nodes: ['node-orchestrator','node-planner','node-strategy','node-contentgen','node-multimodal','node-reviewer','node-channelexec','node-analysis','node-optimizer'], edges: ['edge-1', ...PRODUCTION_EDGES, ...REVIEW_EDGES, 'edge-4', 'edge-5', 'edge-6'] },
};

// Forward-progress ranks. Per-domain-event handlers below use this to advance
// the canvas one stage at a time without regressing — e.g. when ContentGenerated
// arrives AFTER AssetsGenerated (parallel branches), CONTENT_GEN (rank 3) must
// not overwrite the already-applied MULTIMODAL (rank 4).
const PIPELINE_RANK = {
  IDLE: 0, DRAFT: 0,
  PLANNING: 1,
  STRATEGY: 2,
  CONTENT_GEN: 3,
  MULTIMODAL: 4,
  PENDING_REVIEW: 5,
  PRODUCTION: 5,
  EXECUTING: 6, DEPLOYED: 6,
  MONITORING: 7, ANALYZING: 7,
  OPTIMIZING: 8,
  COMPLETED: 9,
};

// Backend campaign_status enum can be LOOP_1..LOOP_5 mid-pipeline; map them
// onto the canvas state set so the OPTIMIZING ring lights up correctly.
function normalizePipelineStatus(status) {
  if (typeof status === 'string' && status.startsWith('LOOP_')) return 'OPTIMIZING';
  return status;
}

// ══════════════════════════════════════════════════════════════════
// Template
// ══════════════════════════════════════════════════════════════════

function renderTemplate() {
  return `
    <section class="hero" data-section="hero">
      <h1 class="hero-title" tabindex="-1">${i18n.t('hero_title_new')}</h1>
      <p class="hero-subtitle">${i18n.t('hero_subtitle_new')}</p>
      <button id="btn-launch" class="btn btn-primary btn-hero">
        ${icon('sprout', 'md')}
        <span>${i18n.t('btn_launch_new')}</span>
      </button>
      <button id="btn-replay-tour" class="tour-replay-link" type="button" style="margin-top: 12px;">
        ${icon('sparkles', 'sm')}
        <span>${i18n.t('tour_replay') || 'Replay tour'}</span>
      </button>
    </section>

    <section class="status-strip" data-section="status">
      <div class="strip-inner">
        <div class="strip-cell strip-label">
          <span class="strip-eyebrow">${i18n.t('strip_current_campaign')}</span>
          <span id="strip-campaign-id" class="strip-value">—</span>
        </div>
        <div class="strip-divider"></div>
        <div class="strip-cell">
          <span class="strip-eyebrow">${i18n.t('strip_state')}</span>
          <span id="strip-campaign-state" class="strip-value">IDLE</span>
        </div>
        <div class="strip-divider"></div>
        <div class="strip-cell">
          <span class="strip-eyebrow">${i18n.t('strip_budget')}</span>
          <span id="strip-budget" class="strip-value">—</span>
        </div>
        <div class="strip-divider"></div>
        <div class="strip-cell">
          <span class="strip-eyebrow">${i18n.t('strip_health')}</span>
          <span id="strip-health" class="strip-value strip-health-good">
            ${icon('dot', 'sm')} ${i18n.t('health_good')}
          </span>
        </div>
      </div>
    </section>

    <section class="orchestration-canvas" data-section="canvas" aria-label="Agent orchestration">
      <header class="canvas-header">
        <h2>${i18n.t('canvas_title')}</h2>
        <p class="canvas-sub">${i18n.t('canvas_sub')}</p>
      </header>
      ${renderCanvas()}
    </section>

    <section class="agent-grid-section" data-section="grid">
      <header class="section-header">
        <h2>${i18n.t('grid_title')}</h2>
        <p>${i18n.t('grid_sub')}</p>
      </header>
      <div class="agent-grid">
        ${AGENT_ORDER.map(renderAgentCard).join('')}
      </div>
    </section>

    <section class="activity-section" data-section="activity">
      <header class="section-header activity-header">
        <h2>${icon('activity', 'md')} ${i18n.t('log_header_new')}</h2>
        <span class="badge badge-live">${icon('dot', 'sm')} ${i18n.t('log_badge_live')}</span>
      </header>
      <div id="activity-log" class="activity-log"></div>
    </section>
  `;
}

function renderCanvas() {
  const node = (id, agentKey, { central = false, gate = false } = {}) => {
    const agent = AGENTS[agentKey];
    const color = agent ? agent.color : 'var(--text-secondary)';
    const iconName = agent?.icon || 'dot';
    const label = agent?.name || '';
    const cls = `agent-neuron${central ? ' central' : ''}${gate ? ' gate' : ''}`;
    const badge = (id === 'node-optimizer')
      ? `<span class="neuron-badge" id="optimizer-loop-badge" hidden></span>` : '';
    return `
      <button id="${id}" class="${cls}" data-agent="${agentKey || ''}" aria-label="Open ${label}" style="--neuron-color:${color}">
        <span class="neuron-icon">${icon(iconName, central ? 'lg' : 'md')}</span>
        <span class="neuron-label">${label}</span>
        ${badge}
      </button>`;
  };

  const reviewerNode = `
    <button id="node-reviewer" class="agent-neuron gate" aria-label="${i18n.t('reviewer_aria') || 'Review gate — open Orchestrator FSM'}" style="--neuron-color: var(--warning)">
      <span class="neuron-icon">${icon('check', 'md')}</span>
      <span class="neuron-label">${i18n.t('reviewer_label') || 'Review'}</span>
    </button>`;

  return `
    <div class="pipeline-canvas-grid">
      <!-- row 1 -->
      <div class="grid-cell"></div>
      <div class="grid-cell"></div>
      <div class="grid-cell">${node('node-strategy', 'strategy')}</div>
      <div class="grid-cell"></div>
      <div class="grid-cell"></div>

      <!-- row 2 -->
      <div class="grid-cell">${node('node-orchestrator', 'orchestrator', { central: true })}</div>
      <div class="grid-cell">${node('node-planner', 'planner', { central: true })}</div>
      <div class="grid-cell">${node('node-contentgen', 'content-gen')}</div>
      <div class="grid-cell">${reviewerNode}</div>
      <div class="grid-cell">${node('node-channelexec', 'channel-exec', { central: true })}</div>

      <!-- row 3 -->
      <div class="grid-cell"></div>
      <div class="grid-cell"></div>
      <div class="grid-cell">${node('node-multimodal', 'multimodal')}</div>
      <div class="grid-cell">${node('node-analysis', 'analysis')}</div>
      <div class="grid-cell">${node('node-optimizer', 'optimizer')}</div>

      <svg class="pipeline-svg-overlay" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path d="M 120 200 L 360 200" class="svg-edge" id="edge-1" />
        <path d="M 360 200 L 600 65"  class="svg-edge" id="edge-2-top" />
        <path d="M 360 200 L 600 200" class="svg-edge" id="edge-2-mid" />
        <path d="M 360 200 L 600 335" class="svg-edge" id="edge-2-bot" />
        <path d="M 600 65  L 840 200" class="svg-edge" id="edge-3-top" />
        <path d="M 600 200 L 840 200" class="svg-edge" id="edge-3-mid" />
        <path d="M 600 335 L 840 200" class="svg-edge" id="edge-3-bot" />
        <path d="M 840 200 L 1080 200" class="svg-edge" id="edge-4" />
        <path d="M 1080 200 L 840 335" class="svg-edge" id="edge-5" />
        <path d="M 840 335 L 1080 335" class="svg-edge" id="edge-6" />
      </svg>
    </div>`;
}

function renderAgentCard(agentId) {
  const a = AGENTS[agentId];
  return `
    <a class="agent-card" href="#/agents/${a.id}" data-agent="${a.id}" style="--agent-color:${a.color}">
      <div class="agent-card-head">
        <span class="agent-card-icon" aria-hidden="true">${icon(a.icon, 'md')}</span>
        <span class="agent-card-name">${a.name}</span>
      </div>
      <div class="agent-card-metric">
        <span class="metric-value" data-metric="${a.id}">—</span>
        <span class="metric-label" data-metric-label="${a.id}">${i18n.t('metric_idle')}</span>
      </div>
      <div class="agent-card-foot">
        <span class="agent-card-event" data-event="${a.id}">${i18n.t('no_recent_event')}</span>
        <span class="agent-card-open">${i18n.t('open_agent')} ${icon('arrow-right', 'sm')}</span>
      </div>
    </a>`;
}

// ══════════════════════════════════════════════════════════════════
// Page controller
// ══════════════════════════════════════════════════════════════════

class Hub {
  constructor() {
    this.unsubscribers = [];
    this.activeCampaignId = null;
    this.lastReviewStatus = null;
    this.logHistory = []; // 内存持久化日志
    this.currentStatus = 'IDLE'; // 内存持久化状态
    this._pollTimer = null;
    this._boundBtnLaunch = null;
    this._boundAnalyze = null;
    this._boundNodes = [];
  }

  async mount(outlet) {
    outlet.innerHTML = renderTemplate();

    this._bindLaunchButton();
    this._bindCanvasNodes();
    this._subscribeEvents();
    this._startPolling();
    
    // 恢复之前的状态
    this._updatePipeline(this.currentStatus);
    if (this.activeCampaignId) {
      this._updateStripState(this.currentStatus);
    }

    // 恢复日志历史
    const logEl = document.getElementById('activity-log');
    if (logEl) {
      this.logHistory.forEach(line => logEl.appendChild(line));
    }

    if (this.logHistory.length === 0) {
      this.log(i18n.t('status_online'), 'success');
    }
  }

  unmount() {
    this.unsubscribers.forEach(fn => { try { fn(); } catch {} });
    this.unsubscribers = [];

    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;

    this._boundNodes.forEach(({ el, fn }) => el?.removeEventListener('click', fn));
    this._boundNodes = [];
    
    // 清除 DOM 引用但保留日志对象
    const logEl = document.getElementById('activity-log');
    if (logEl) logEl.innerHTML = ''; 
  }

  // ── Binding ──────────────────────────────────────────────────

  _bindLaunchButton() {
    const btn = document.getElementById('btn-launch');
    if (!btn) return;
    const handler = () => this._openLaunchModal();
    btn.addEventListener('click', handler);
    this._boundBtnLaunch = { el: btn, fn: handler };

    // Replay-tour link — calls into the onboarding engine exposed on window.OAG.
    const replay = document.getElementById('btn-replay-tour');
    if (replay) {
      replay.addEventListener('click', () => {
        try { window.OAG?.tour?.reset?.(); } catch (e) { console.warn('[hub] tour reset', e); }
      });
    }
  }

  _bindCanvasNodes() {
    AGENT_ORDER.forEach(agentId => {
      const agent = AGENTS[agentId];
      const el = document.getElementById(agent.nodeId);
      if (!el) return;
      const fn = () => router.navigate(`/agents/${agentId}`);
      el.addEventListener('click', fn);
      this._boundNodes.push({ el, fn });
    });
    // Review gate is not an agent — open Orchestrator FSM where review state lives.
    const reviewer = document.getElementById('node-reviewer');
    if (reviewer) {
      const fn = () => router.navigate('/agents/orchestrator', { tab: 'fsm' });
      reviewer.addEventListener('click', fn);
      this._boundNodes.push({ el: reviewer, fn });
    }
  }

  // ── Event subscriptions ─────────────────────────────────────

  _subscribeEvents() {
    const sub = (type, handler) => {
      const unsub = globalEventBus.subscribe(type, handler);
      if (typeof unsub === 'function') this.unsubscribers.push(unsub);
    };

    sub('StatusChanged', ({ payload: { old_status, new_status }, campaign_id }) => {
      this.log(i18n.t('log_campaign_status_change', { id: campaign_id?.slice(0,8), old: old_status, new: new_status }), 'info');
      this.activeCampaignId = campaign_id || this.activeCampaignId;
      this.currentStatus = new_status;
      this._updateStripState(new_status);
      this._updateCampaignBadge(new_status);
      // StatusChanged is authoritative — let it override the canvas (e.g. so
      // PAUSED / COMPLETED / FAILED can reset or finalize). LOOP_N maps to
      // OPTIMIZING.
      this._updatePipeline(normalizePipelineStatus(new_status));
      this._updateAgentCard('orchestrator', { metric: new_status, label: i18n.t('metric_state'), event: i18n.t('event_just_now') });
    });

    sub('ReviewCompleted', ({ payload }) => {
      const status = payload?.status;
      this.lastReviewStatus = status;
      if (status && status !== 'APPROVED') {
        this.log(i18n.t('log_review_rejected', { feedback: payload?.feedback || '' }), 'warning');
        this._triggerReviewRebound();
      } else {
        this._advancePipeline('PENDING_REVIEW');
      }
    });

    sub('PlanGenerated', ({ payload: { plan } }) => {
      this.log(i18n.t('log_planner_dag', { n: plan.tasks.length, s: plan.scenario }), 'info');
      this._updateAgentCard('planner', { metric: plan.tasks.length, label: i18n.t('metric_tasks'), event: plan.scenario });
      this._advancePipeline('PLANNING');
    });

    sub('StrategyDecided', ({ payload: { strategy } }) => {
      const channels = strategy.channel_plan?.map(c => c.channel).join(', ');
      this.log(i18n.t('log_strategy_decided', { channels }), 'info');
      this._updateAgentCard('strategy', { metric: strategy.channel_plan?.length || 0, label: i18n.t('metric_channels'), event: channels || '—' });
      this._advancePipeline('STRATEGY');
    });

    sub('ContentGenerated', ({ payload: { bundle } }) => {
      const count = bundle?.variants?.length || 0;
      this.log(i18n.t('log_content_gen', { n: count }), 'success');
      this._updateAgentCard('content-gen', { metric: count, label: i18n.t('metric_variants'), event: i18n.t('event_just_now') });
      this._advancePipeline('CONTENT_GEN');
    });

    sub('AssetsGenerated', ({ payload: { asset_ids, type } }) => {
      this.log(i18n.t('log_assets_gen', { n: asset_ids.length, type }), 'success');
      this._updateAgentCard('multimodal', { metric: asset_ids.length, label: i18n.t('metric_assets'), event: type });
      this._advancePipeline('MULTIMODAL');
    });

    sub('AdDeployed', ({ payload }) => {
      const platforms = payload.platforms?.join(', ') || '';
      this.log(i18n.t('log_ads_deployed', { platforms }), 'success');
      this._updateAgentCard('channel-exec', { metric: (payload.platforms?.length ?? 0), label: i18n.t('metric_platforms'), event: platforms });
      this._advancePipeline('DEPLOYED');
    });

    sub('ReportGenerated', ({ payload }) => {
      const { roas, ctr } = payload.metrics || {};
      this.log(i18n.t('log_analytics_report', { roas: roas?.toFixed(2), ctr: ((ctr ?? 0) * 100).toFixed(2) }), 'info');
      const pct = `+${((roas - 1) * 100)?.toFixed(1)}%`;
      this._updateAgentCard('analysis', { metric: pct, label: i18n.t('metric_roi'), event: `CTR ${((ctr ?? 0) * 100).toFixed(1)}%` });
      this._advancePipeline('ANALYZING');
    });

    sub('OptimizationApplied', ({ payload }) => {
      const types = payload.actions?.map(a => a.type).join(', ') || 'NONE';
      this.log(i18n.t('log_optimizer_fired', { types }), 'warning');
      this._updateAgentCard('optimizer', { metric: `#${payload.loop_count ?? 0}`, label: i18n.t('metric_cycle'), event: types });
      this._updateOptimizerLoopBadge(payload.loop_count);
      this._advancePipeline('OPTIMIZING');
    });

    sub('AnomalyDetected', ({ payload }) => {
      this.log(i18n.t('log_anomaly_detected', { metric: payload.metric, channel: payload.channel, severity: payload.severity }), 'error');
      this._updateStripHealth('warning');
    });
  }

  // Forward-only pipeline advance. Drops events that would regress the canvas
  // (matters when content-gen and multimodal run in parallel and arrive
  // out-of-order, or when a duplicate is replayed by the end-of-run broadcast).
  _advancePipeline(stage) {
    const next = PIPELINE_RANK[stage];
    if (next == null) return;
    const cur = PIPELINE_RANK[normalizePipelineStatus(this.currentStatus)] ?? 0;
    if (next > cur) this._updatePipeline(stage);
  }

  _startPolling() {
    // Lightweight heartbeat for strip health indicator fade.
    this._pollTimer = setInterval(() => {
      const ws = getCtx().wsBroadcaster;
      const connected = ws?.isConnected?.() ?? true;
      if (!connected) this._updateStripHealth('disconnected');
    }, 6000);
  }

  // ── Pipeline visualization ──────────────────────────────────

  _updatePipeline(status) {
    const current = PIPELINE_STATE[status] || PIPELINE_STATE.IDLE;
    this.currentStatus = status;

    document.querySelectorAll('.agent-neuron, .svg-edge').forEach(el => {
      el.classList.remove('active', 'working', 'fading');
    });

    // Terminal/idle states: stop all infinite animations on the canvas.
    if (status === 'COMPLETED' || status === 'IDLE' || status === 'DRAFT') return;

    const nodes = current.nodes;
    if (nodes.length === 0) return;

    // The real graph fans out strategy → content_gen ‖ multimodal in parallel.
    // While either branch is in flight (CONTENT_GEN or MULTIMODAL), light up
    // BOTH so the parallelism is visible, with strategy fading behind them.
    if (status === 'CONTENT_GEN' || status === 'MULTIMODAL') {
      document.getElementById('node-contentgen')?.classList.add('active', 'working');
      document.getElementById('node-multimodal')?.classList.add('active', 'working');
      document.getElementById('node-strategy')?.classList.add('fading');
    } else {
      const currentNodeId = nodes[nodes.length - 1];
      document.getElementById(currentNodeId)?.classList.add('active', 'working');
      if (nodes.length > 1) {
        document.getElementById(nodes[nodes.length - 2])?.classList.add('fading');
      }
    }

    current.edges.forEach(id => document.getElementById(id)?.classList.add('active'));
  }

  // Flash the review→strategy path when the reviewer rejects, then reset
  // the canvas rank so the upcoming StrategyDecided event can advance again.
  _triggerReviewRebound() {
    const nodeIds = ['node-reviewer', 'node-strategy'];
    const edgeIds = ['edge-3-top', 'edge-3-mid', 'edge-3-bot', 'edge-2-top', 'edge-2-mid', 'edge-2-bot'];
    [...nodeIds, ...edgeIds].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('rebound');
      // Force reflow so the animation restarts on re-add.
      void el.offsetWidth;
      el.classList.add('rebound');
      setTimeout(() => el.classList.remove('rebound'), 1400);
    });
    // Allow the canvas to re-advance forward from STRATEGY when the revise
    // loop publishes StrategyDecided again.
    this.currentStatus = 'PLANNING';
  }

  _updateOptimizerLoopBadge(loopCount) {
    const badge = document.getElementById('optimizer-loop-badge');
    if (!badge) return;
    const n = Number(loopCount) || 0;
    if (n <= 0) {
      badge.hidden = true;
      badge.textContent = '';
    } else {
      badge.hidden = false;
      badge.textContent = `L${n}`;
    }
  }

  // ── Status strip ────────────────────────────────────────────

  _updateStripState(state) {
    const idEl   = document.getElementById('strip-campaign-id');
    const stEl   = document.getElementById('strip-campaign-state');
    if (idEl && this.activeCampaignId) idEl.textContent = this.activeCampaignId.slice(0, 8).toUpperCase();
    if (stEl) stEl.textContent = state || '—';
  }

  _updateStripHealth(level) {
    const el = document.getElementById('strip-health');
    if (!el) return;
    el.className = 'strip-value strip-health-' + level;
    const text = {
      good:         i18n.t('health_good'),
      warning:      i18n.t('health_warning'),
      disconnected: i18n.t('health_disconnected'),
    }[level] || '—';
    el.innerHTML = `${icon('dot', 'sm')} ${text}`;
  }

  _updateCampaignBadge(status) {
    const badge = document.getElementById('campaign-status-badge');
    if (!badge) return;
    const key = `status_${String(status).toLowerCase()}`;
    const translated = i18n.t(key);
    badge.textContent = (translated !== key) ? translated : status;
  }

  // ── Agent card updates ──────────────────────────────────────

  _updateAgentCard(agentId, { metric, label, event }) {
    const metricEl = document.querySelector(`[data-metric="${agentId}"]`);
    const labelEl  = document.querySelector(`[data-metric-label="${agentId}"]`);
    const eventEl  = document.querySelector(`[data-event="${agentId}"]`);
    if (metricEl) { metricEl.style.opacity = '0'; setTimeout(() => { metricEl.textContent = metric; metricEl.style.opacity = '1'; }, 160); }
    if (labelEl && label) labelEl.textContent = label;
    if (eventEl  && event) eventEl.textContent = event;
  }

  // ── Activity log ────────────────────────────────────────────

  log(message, type = 'info') {
    const logEl = document.getElementById('activity-log');
    const line = document.createElement('div');
    line.className = `log-entry log-${type}`;
    line.innerHTML = `
      <span class="log-time">${new Date().toLocaleTimeString()}</span>
      <span class="log-msg">${message}</span>
    `;
    
    this.logHistory.unshift(line);
    if (this.logHistory.length > 40) this.logHistory.pop();
    
    if (logEl) {
      logEl.prepend(line);
    }
  }

  // ── Launch modal (lives in index.html as a global overlay) ──

  _openLaunchModal() {
    const modal = document.getElementById('launch-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    if (!modal.dataset.bound) {
      this._wireLaunchModal();
      modal.dataset.bound = 'true';
    }
  }

  _wireLaunchModal() {
    const close = () => { document.getElementById('launch-modal').style.display = 'none'; };

    document.getElementById('btn-close-launch-modal')?.addEventListener('click', close);
    document.getElementById('btn-cancel-launch')?.addEventListener('click', close);

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._syncLaunchForm(btn.dataset.type);
      });
    });

    document.querySelectorAll('.channel-card').forEach(card => {
      card.addEventListener('click', () => card.classList.toggle('active'));
    });

    document.getElementById('promo-objective-select')?.addEventListener('change', (e) => {
      this._syncKpiUnit(e.target.value);
    });

    document.getElementById('btn-analyze-url')?.addEventListener('click', () => this._analyzeUrl());
    document.getElementById('btn-confirm-launch')?.addEventListener('click', () => this._confirmLaunch());
  }

  _syncLaunchForm(type) {
    const urlLabel = document.getElementById('label-url');
    const urlInput = document.getElementById('promo-url-input');
    const locationGroup = document.getElementById('location-group');
    const objectiveSelect = document.getElementById('promo-objective-select');

    const configs = {
      ecom:     { label: 'Product URL (Amazon/Shopify)',     placeholder: 'https://amazon.com/dp/...',        showLocation: true,  defaultObjective: 'conversion' },
      software: { label: 'Project/Repo URL (GitHub/AppStore)',placeholder: 'https://github.com/user/repo',     showLocation: false, defaultObjective: 'growth' },
      lead:     { label: 'Landing Page URL',                 placeholder: 'https://your-business.com/demo',    showLocation: true,  defaultObjective: 'traffic' },
    };
    const c = configs[type] || configs.ecom;
    if (urlLabel) urlLabel.textContent = c.label;
    if (urlInput) urlInput.placeholder = c.placeholder;
    if (locationGroup) locationGroup.style.display = c.showLocation ? 'block' : 'none';
    if (objectiveSelect) { objectiveSelect.value = c.defaultObjective; this._syncKpiUnit(c.defaultObjective); }
  }

  _syncKpiUnit(objective) {
    const unitEl = document.getElementById('kpi-unit');
    const kpiInput = document.getElementById('promo-kpi-input');
    const units = { growth: 'CPA (Star)', awareness: 'CPM', conversion: 'ROAS', traffic: 'CPC' };
    if (unitEl) unitEl.textContent = units[objective] || 'Target';
    if (kpiInput) kpiInput.value = (objective === 'conversion') ? '3.0' : '1.0';
  }

  async _analyzeUrl() {
    const { api } = getCtx();
    const urlInput = document.getElementById('promo-url-input');
    const url = urlInput?.value?.trim();
    const type = document.querySelector('.tab-btn.active')?.dataset.type || 'ecom';

    if (!url || !url.startsWith('http')) { alert('Please enter a valid URL first.'); return; }

    const btn = document.getElementById('btn-analyze-url');
    const ic = document.getElementById('analyze-icon');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
    if (ic) ic.innerHTML = icon('clock', 'sm');

    try {
      const response = await api.analyzeUrl(url, type);
      if (response.success) {
        this._fillForm(response.data);
        this.log('AI analysis complete — form updated.', 'success');
      } else {
        this.log(`AI analysis failed: ${response.error}`, 'error');
      }
    } catch (err) {
      this.log(`AI analysis failed: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      if (ic) ic.innerHTML = icon('sparkles', 'sm');
    }
  }

  _fillForm(data) {
    if (!data) return;
    const descInput = document.getElementById('promo-goal-input');
    if (descInput) {
      const productPart = data.product_name ? `${data.product_name}: ` : '';
      const descPart = data.description || '';
      let uspsPart = '';
      if (Array.isArray(data.core_usps) && data.core_usps.length > 0) {
        uspsPart = `\n\nUSPs:\n- ${data.core_usps.join('\n- ')}`;
      }
      descInput.value = `${productPart}${descPart}${uspsPart}`;
    }
    const objSel = document.getElementById('promo-objective-select');
    const objMap = { brand_awareness: 'awareness', user_growth: 'growth', sales_conversion: 'conversion', website_traffic: 'traffic' };
    const mapped = objMap[data.campaign_goal_suggested];
    if (mapped && objSel) { objSel.value = mapped; this._syncKpiUnit(mapped); }
  }

  async _confirmLaunch() {
    const { api } = getCtx();
    const type      = document.querySelector('.tab-btn.active')?.dataset.type || 'ecom';
    const url       = document.getElementById('promo-url-input')?.value?.trim();
    const desc      = document.getElementById('promo-goal-input')?.value?.trim();
    const objective = document.getElementById('promo-objective-select')?.value;
    const budget    = parseInt(document.getElementById('promo-budget-input')?.value || '10000', 10);
    const kpi       = parseFloat(document.getElementById('promo-kpi-input')?.value || '1.0');
    const duration  = parseInt(document.getElementById('promo-duration-input')?.value || '7', 10);
    const location  = document.getElementById('promo-location-select')?.value || 'CN';
    const channels  = Array.from(document.querySelectorAll('.channel-card.active')).map(c => c.dataset.channel);

    if (!url || !url.startsWith('http')) { alert('Please enter a valid URL.'); return; }

    document.getElementById('launch-modal').style.display = 'none';

    this._updatePipeline('PLANNING');

    const metricMap = { growth: 'CAC', awareness: 'REACH', conversion: 'ROAS', traffic: 'CTR' };
    const backendMetric = metricMap[objective] || 'ROAS';
    const campaignGoal = `[Type: ${type.toUpperCase()}] Objective: ${objective}. Desc: ${desc}. URL: ${url}. Region: ${location}.`;

    const campaignName = (desc || '').trim().slice(0, 60) || `${type.toUpperCase()} · ${objective}`;

    const response = await api.createCampaign({
      name: campaignName,
      goal: campaignGoal,
      campaign_type: type,
      budget: { total: budget, currency: 'CNY' },
      timeline: {
        start: new Date().toISOString().split('T')[0],
        end: new Date(Date.now() + duration * 86400000).toISOString().split('T')[0],
        duration_days: duration,
      },
      kpi: { metric: backendMetric, target: kpi },
      constraints: { channels, region: location, url },
    });

    if (!response.success) {
      const errMsg = typeof response.error === 'object' ? JSON.stringify(response.error) : response.error;
      this.log(`Launch failed: ${errMsg}`, 'error');
      return;
    }

    this.activeCampaignId = response.data.id;
    this.log(i18n.t('log_campaign_created', { id: this.activeCampaignId.slice(0, 8) }), 'success');
    this._updateCampaignBadge(response.data.status);
    this._updateStripState(response.data.status);
    document.getElementById('strip-campaign-id').textContent = this.activeCampaignId.slice(0, 8).toUpperCase();
    document.getElementById('strip-budget').textContent = `${budget} ${response.data.budget?.currency || 'CNY'}`;

    try {
      wsBroadcaster.subscribe(this.activeCampaignId, (msg) => {
        this._handleWsMessage(msg);
      });
    } catch (e) { console.warn('[hub] ws subscribe failed', e); }

    const startResp = await api.startCampaign(this.activeCampaignId);
    if (startResp.success) {
      this._updateCampaignBadge('PLANNING');
      this._updateStripState('PLANNING');
    } else {
      this.log(`Start failed: ${startResp.error}`, 'error');
    }
  }

  _handleWsMessage(msg) {
    const { type, payload, campaign_id } = msg;
    switch (type) {
      case 'campaign.status_changed':
        this._updateCampaignBadge(payload.new_status);
        this._updateStripState(payload.new_status);
        this._updatePipeline(normalizePipelineStatus(payload.new_status));
        break;
      case 'campaign.plan_ready':
        this._advancePipeline('PLANNING');
        this._updateAgentCard('planner', { metric: payload.plan?.tasks?.length ?? 0, label: i18n.t('metric_tasks'), event: payload.plan?.scenario || '—' });
        break;
      case 'task.content_generated':
        this._advancePipeline('CONTENT_GEN');
        this._updateAgentCard('content-gen', { metric: payload.bundle?.variants?.length ?? 0, label: i18n.t('metric_variants'), event: i18n.t('event_just_now') });
        break;
      case 'task.assets_generated':
        this._advancePipeline('MULTIMODAL');
        this._updateAgentCard('multimodal', { metric: payload.asset_ids?.length ?? 0, label: i18n.t('metric_assets'), event: payload.type });
        break;
      case 'task.strategy_decided':
        this._advancePipeline('STRATEGY');
        this._updateAgentCard('strategy', { metric: payload.strategy?.channel_plan?.length ?? 0, label: i18n.t('metric_channels'), event: payload.strategy?.channel_plan?.map(c => c.channel).join(', ') });
        break;
      case 'task.ad_deployed':
        this._advancePipeline('DEPLOYED');
        this._updateAgentCard('channel-exec', { metric: payload.platforms?.length ?? 0, label: i18n.t('metric_platforms'), event: payload.platforms?.join(', ') });
        break;
      case 'metrics.updated': {
        this._advancePipeline('ANALYZING');
        const roas = payload.metrics?.roas;
        const pct = roas != null ? `+${((roas - 1) * 100).toFixed(1)}%` : '—';
        this._updateAgentCard('analysis', { metric: pct, label: i18n.t('metric_roi'), event: `CTR ${((payload.metrics?.ctr ?? 0) * 100).toFixed(1)}%` });
        break;
      }
      case 'optimization.applied': {
        this._advancePipeline('OPTIMIZING');
        const types = payload.actions?.map(a => a.type).join(', ') || 'NONE';
        this._updateAgentCard('optimizer', { metric: `#${payload.loop_count ?? 0}`, label: i18n.t('metric_cycle'), event: types });
        break;
      }
      case 'anomaly.detected':
        this._updateStripHealth('warning');
        break;
    }
  }
}

// 单例持有状态，避免切页丢失日志和动画进度
const hubInstance = new Hub();

export default {
  titleKey: 'page_hub_title',

  async mount(outlet, ctx) {
    await hubInstance.mount(outlet, ctx);
  },

  unmount() {
    hubInstance.unmount();
  },
};
