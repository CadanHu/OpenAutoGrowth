import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID = 'orchestrator';

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()  { return window.OAG || {}; }
function t(k, d)   { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CAMPAIGN_STATES = [
  'DRAFT', 'PLANNING', 'PENDING_REVIEW', 'PRODUCTION', 'DEPLOYED', 'MONITORING', 'OPTIMIZING', 'PAUSED', 'COMPLETED'
];

let frame = null;
let selectedCampaignId = null;

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  function paint() {
    const orchestrator = getCtx().orchestrator;
    const campaignsMap = orchestrator?.campaigns || new Map();
    const campaigns = Array.from(campaignsMap.values());
    
    const total = campaigns.length;
    const active = campaigns.filter(c => c.status !== 'COMPLETED' && c.status !== 'PAUSED').length;
    const paused = campaigns.filter(c => c.status === 'PAUSED').length;
    const events = getCtx().eventBus?.history?.length || 0;

    panel.innerHTML = `
      <div class="metric-row">
        <div class="metric-box">
          <span class="metric-label">${t('orch_metric_total', 'Total Campaigns')}</span>
          <span class="metric-value">${total}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('orch_metric_active', 'Active')}</span>
          <span class="metric-value">${active}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('orch_metric_paused', 'Paused/Anomaly')}</span>
          <span class="metric-value">${paused}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('orch_metric_events', 'Total Events')}</span>
          <span class="metric-value">${events}</span>
        </div>
      </div>

      ${total === 0 
        ? `<div class="dag-empty"><p>${t('orch_no_campaigns', 'No campaigns yet. Launch one from Hub.')}</p></div>`
        : `
          <table class="attr-table">
            <thead>
              <tr>
                <th>${t('orch_col_id', 'Campaign ID')}</th>
                <th>${t('orch_col_name', 'Name')}</th>
                <th>${t('orch_col_status', 'Status')}</th>
                <th class="num">${t('orch_col_loops', 'Loops')}</th>
              </tr>
            </thead>
            <tbody>
              ${campaigns.map(c => `
                <tr>
                  <td><code class="code-inline">${escapeHtml(c.campaign_id)}</code></td>
                  <td>${escapeHtml(c.name || '—')}</td>
                  <td><span class="cred-status-sandbox">${escapeHtml(c.status)}</span></td>
                  <td class="num">${c.loop_count || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `
      }
    `;
    setStatus(total > 0 ? t('multimodal_status_ready', 'Ready') : t('metric_idle', 'Idle'));
  }
  
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const eventsToWatch = ['PlanGenerated', 'AdDeployed', 'OptimizationApplied', 'AnomalyDetected'];
  const unsubs = eventsToWatch.map(ev => ctx.eventBus.subscribe(ev, paint));
  return () => { unsubs.forEach(u => { try { u(); } catch {} }) };
}

// ── Tab: FSM View ─────────────────────────────────────────────────
function renderFsm(panel) {
  function paint() {
    const orchestrator = getCtx().orchestrator;
    const campaignsMap = orchestrator?.campaigns || new Map();
    const campaigns = Array.from(campaignsMap.values());

    if (campaigns.length === 0) {
      panel.innerHTML = `<div class="dag-empty"><p>${t('orch_no_campaigns', 'No campaigns yet.')}</p></div>`;
      return;
    }

    if (!selectedCampaignId || !campaignsMap.has(selectedCampaignId)) {
      selectedCampaignId = campaigns[0].campaign_id;
    }

    const currentCampaign = campaignsMap.get(selectedCampaignId);
    let currentNormStatus = currentCampaign.status;
    if (currentNormStatus && currentNormStatus.startsWith('LOOP_')) {
      currentNormStatus = 'OPTIMIZING';
    }

    panel.innerHTML = `
      <div class="fsm-layout">
        <div class="fsm-sidebar">
          <div class="menu-group-title">${t('orch_sidebar_title', 'Campaigns')}</div>
          ${campaigns.map(c => `
            <div class="fsm-sidebar-item ${c.campaign_id === selectedCampaignId ? 'active' : ''}" data-cid="${escapeHtml(c.campaign_id)}">
              <div class="tiny text-truncate">${escapeHtml(c.name || c.campaign_id)}</div>
              <div class="status-indicator ${c.status === 'PAUSED' ? 'warning' : 'ok'}"></div>
            </div>
          `).join('')}
        </div>
        <div class="fsm-canvas">
          <h3 class="fsm-canvas-title">${t('orch_fsm_title', 'State Machine')} — ${escapeHtml(currentCampaign.campaign_id)}</h3>
          <div class="fsm-nodes">
            ${CAMPAIGN_STATES.map((st, idx) => {
              const isActive = st === currentNormStatus;
              const isPast = CAMPAIGN_STATES.indexOf(currentNormStatus) > idx;
              return `
                <div class="fsm-node ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}">
                  <div class="fsm-node-box">${st}</div>
                  ${idx < CAMPAIGN_STATES.length - 1 ? `<div class="fsm-edge"></div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div class="fsm-details">
            <p class="muted tiny">${t('orch_fsm_hint', 'Orchestrator advances campaign state based on system events.')}</p>
            ${currentCampaign.status.startsWith('LOOP_') ? `<p class="muted tiny">Current loop: ${currentCampaign.loop_count}</p>` : ''}
          </div>
        </div>
      </div>
    `;

    panel.querySelectorAll('.fsm-sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        selectedCampaignId = item.dataset.cid;
        paint();
      });
    });
  }

  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const eventsToWatch = ['PlanGenerated', 'AdDeployed', 'OptimizationApplied', 'AnomalyDetected'];
  const unsubs = eventsToWatch.map(ev => ctx.eventBus.subscribe(ev, paint));
  return () => { unsubs.forEach(u => { try { u(); } catch {} }) };
}

// ── Tab: Logs ─────────────────────────────────────────────────────
function renderLogs(panel) {
  function paint() {
    const events = getCtx().eventBus?.history || [];
    panel.innerHTML = `
      <div class="logs-view full-height">
        ${events.length
          ? events.slice().reverse().map(e => {
              return `
                <div class="log-line">
                  <span class="log-time">${fmtTime(e.occurred_at)}</span>
                  <span class="log-type">${e.event_type}</span>
                  <span class="log-msg">${escapeHtml(e.campaign_id || 'system')}</span>
                  <span class="log-payload tiny muted text-truncate" title="${escapeHtml(JSON.stringify(e.payload))} ">${escapeHtml(JSON.stringify(e.payload))}</span>
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
  // This tab watches ALL events to show the global log
  const unsub = ctx.eventBus.subscribe('*', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Page module ───────────────────────────────────────────────────
export default {
  titleKey: 'page_orchestrator_title',

  async mount(outlet, ctx) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    const requestedTab = ctx?.query?.tab;

    frame = createAgentFrame({
      agent,
      runLabelKey: 'agent_tab_playground',
      runLabelFallback: 'Run',
      runIconName: 'play',
      onRun: () => {}, // read-only agent
      defaultTabId: requestedTab || 'overview',
      tabs: [
        { id: 'overview', labelKey: 'agent_tab_overview',  label: 'Overview',     icon: 'activity',     render: renderOverview },
        { id: 'fsm',      labelKey: 'orch_tab_fsm',        label: 'FSM View',     icon: 'git-merge',    render: renderFsm },
        { id: 'logs',     labelKey: 'agent_tab_logs',      label: 'Logs',         icon: 'align-left',   render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
  },
};
