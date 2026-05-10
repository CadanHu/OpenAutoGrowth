import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';
import {
  getActiveCid,
  setActiveCid,
  resolveDefaultCid,
  subscribeCampaignChange,
  statusBadgeClass as sharedStatusBadgeClass,
} from '../campaign-context.js';

const AGENT_ID = 'orchestrator';

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()  { return window.OAG || {}; }
function t(k, d)   { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
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
function shortId(id) { return id ? String(id).slice(0, 8) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CAMPAIGN_STATES = [
  'DRAFT', 'PLANNING', 'PENDING_REVIEW', 'PRODUCTION', 'DEPLOYED', 'MONITORING', 'OPTIMIZING', 'PAUSED', 'COMPLETED'
];

// Status → semantic class for the small badges in the sidebar / lists.
function statusBadgeClass(status) {
  if (!status) return 'muted';
  if (status === 'PAUSED') return 'warning';
  if (status === 'COMPLETED') return 'success';
  if (status === 'DRAFT') return 'muted';
  if (status.endsWith('_FAILED') || status === 'FAILED') return 'danger';
  return 'active'; // PLANNING / PENDING_REVIEW / PRODUCTION / DEPLOYED / MONITORING / OPTIMIZING / LOOP_*
}

// Pipeline bucket definitions for the Overview tab. Order matters — this is
// the left-to-right rendering order. `match(status)` returns true if a
// campaign in `status` belongs to the bucket. Every status maps to exactly
// one bucket, so the totals add up to campaigns.length.
const PIPELINE_BUCKETS = [
  { key: 'planning',   labelKey: 'orch_bucket_planning',   label: 'Planning',   tone: 'active',  match: s => s === 'DRAFT' || s === 'PLANNING' || s === 'PENDING_REVIEW' },
  { key: 'production', labelKey: 'orch_bucket_production', label: 'Production', tone: 'active',  match: s => ['PRODUCTION','CONTENT_GEN','STRATEGY','MULTIMODAL','EXECUTING'].includes(s) },
  { key: 'deployed',   labelKey: 'orch_bucket_deployed',   label: 'Deployed',   tone: 'active',  match: s => s === 'DEPLOYED' },
  { key: 'monitoring', labelKey: 'orch_bucket_monitoring', label: 'Monitoring', tone: 'active',  match: s => s === 'MONITORING' },
  { key: 'optimizing', labelKey: 'orch_bucket_optimizing', label: 'Optimizing', tone: 'active',  match: s => s === 'OPTIMIZING' || (s && s.startsWith('LOOP_')) },
  { key: 'paused',     labelKey: 'orch_bucket_paused',     label: 'Paused',     tone: 'warning', match: s => s === 'PAUSED' },
  { key: 'completed',  labelKey: 'orch_bucket_completed',  label: 'Completed',  tone: 'success', match: s => s === 'COMPLETED' },
  { key: 'failed',     labelKey: 'orch_bucket_failed',     label: 'Failed',     tone: 'danger',  match: s => s === 'FAILED' || (s && s.endsWith('_FAILED')) },
];

// Map a clicked FSM target state → which manual-intervention action it
// corresponds to, given the campaign's current status. Returns null if the
// target isn't directly invokable (system-driven transitions like
// PLANNING → PRODUCTION belong to the pipeline, not to the user).
//
// Mirrors the transition allow-list in
// `backend/app/api/campaigns.py` :: TRANSITIONS — keep these in sync.
function nodeActionFor(currentStatus, targetState) {
  if (!currentStatus || !targetState || currentStatus === targetState) return null;
  const isLoop = typeof currentStatus === 'string' && currentStatus.startsWith('LOOP_');
  if (targetState === 'PAUSED') {
    const allowed = isLoop || ['DEPLOYED','MONITORING','OPTIMIZING'].includes(currentStatus);
    return allowed ? { action: 'pause', label: 'Pause' } : null;
  }
  if (targetState === 'MONITORING' && currentStatus === 'PAUSED') {
    return { action: 'resume', label: 'Resume' };
  }
  if (targetState === 'COMPLETED') {
    const allowed = isLoop || ['MONITORING','OPTIMIZING','PAUSED'].includes(currentStatus);
    return allowed ? { action: 'complete', label: 'Mark complete' } : null;
  }
  return null;
}

const BUCKET_TONE_COLOR = {
  active:  'var(--accent-primary)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  danger:  'var(--danger)',
  muted:   'var(--text-tertiary)',
};

let frame = null;
// Dedup concurrent fetches so simultaneous tab paints share one request,
// but still allow re-fetch on later paints (after a pause-all etc.) so the
// page reflects current backend state instead of an SPA-lifetime cache.
let campaignsInflight = null;
let campaignsLastFetched = 0;
const CAMPAIGNS_CACHE_MS = 1500;

// ── Shared selected-campaign state ─────────────────────────────────
// Now lives in `src/ui/campaign-context.js` so the top-nav selector and
// every agent page see the same value. Wrap setActiveCid here so the
// orchestrator's per-tab `invalidateCampaignDetail` cache also gets reset
// alongside the URL update.
function _setActiveCid(id) {
  setActiveCid(id);
  invalidateCampaignDetail();
}

async function ensureCampaigns(force = false) {
  const ctx = getCtx();
  const orchestrator = ctx.orchestrator;
  if (!orchestrator) return;
  const map = orchestrator.campaigns || new Map();
  const fresh = Date.now() - campaignsLastFetched < CAMPAIGNS_CACHE_MS;
  if (!force && fresh && map.size > 0) return;
  if (campaignsInflight) return campaignsInflight;
  campaignsInflight = (async () => {
  try {
    const resp = await ctx.api?.listCampaigns?.({ limit: 50 });
    // Only reconcile if the request actually succeeded — a transient backend
    // error must not wipe the Map (the user would lose their selection and
    // any in-flight optimistic updates).
    if (resp?.success && Array.isArray(resp.data?.items)) {
      const backendIds = new Set();
      resp.data.items.forEach(c => {
        const id = c.id || c.campaign_id;
        backendIds.add(id);
        const existing = map.get(id) || {};
        // Always refresh status + timestamps so the Orchestrator page reflects
        // backend state (e.g. after a "Pause all" the campaigns Map's stale
        // status would otherwise persist for the lifetime of the SPA session).
        map.set(id, {
          ...existing,
          campaign_id: id,
          name: c.name || c.goal || id,
          status: c.status || 'DRAFT',
          loop_count: c.loop_count ?? existing.loop_count ?? 0,
          active_tasks: c.active_tasks || existing.active_tasks || [],
          created_at: c.created_at || existing.created_at,
          updated_at: c.updated_at || existing.updated_at,
        });
      });
      // Drop orphans — entries the local Map holds but the backend doesn't.
      // Most commonly seeded by `Orchestrator.js`'s legacy localStorage
      // hydration (`oag_campaigns`); without this prune they would forever
      // bias bucket counts and the FSM sidebar.
      for (const id of map.keys()) {
        if (!backendIds.has(id)) map.delete(id);
      }
      // Ensure the orchestrator references our Map even if it started null.
      if (!orchestrator.campaigns) orchestrator.campaigns = map;
    }
  } catch (e) {
    console.warn('[Orchestrator] ensureCampaigns failed:', e);
  } finally {
    campaignsLastFetched = Date.now();
    campaignsInflight = null;
  }
  })();
  return campaignsInflight;
}

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  async function paint() {
    await ensureCampaigns();
    const orchestrator = getCtx().orchestrator;
    const campaignsMap = orchestrator?.campaigns || new Map();
    const campaigns = Array.from(campaignsMap.values());
    
    const buckets = PIPELINE_BUCKETS.map(b => ({
      ...b,
      count: campaigns.filter(c => b.match(c.status)).length,
    }));
    const total = campaigns.length;

    const agents = Object.values(AGENTS);

    panel.innerHTML = `
      <div class="panel-card" style="margin-bottom: 24px;">
        <header class="panel-card-head">
          <h3>${t('orch_pipeline_dist', 'Pipeline Distribution')}</h3>
          <span class="tiny muted">${total} ${t('orch_total_campaigns', 'total')}</span>
        </header>
        <div class="panel-card-body" style="display: flex; flex-wrap: wrap; gap: 10px; padding: 20px;">
          ${buckets.map(b => {
            const color = BUCKET_TONE_COLOR[b.tone] || 'var(--text-tertiary)';
            const dim = b.count === 0;
            return `
              <div style="flex: 1 1 130px; min-width: 120px; background: var(--bg-L2); border-radius: 8px; padding: 14px 12px; text-align: center; border: 1px solid var(--border-subtle); border-top: 3px solid ${color}; ${dim ? 'opacity: 0.55;' : ''}">
                <div style="font-size: 24px; font-weight: bold; color: ${b.count > 0 ? color : 'var(--text-tertiary)'}; margin-bottom: 4px;">${b.count}</div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); letter-spacing: 0.05em;">${t(b.labelKey, b.label)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="panel-card">
        <header class="panel-card-head">
          <h3>${t('orch_agent_status', 'Agents Status Grid')}</h3>
        </header>
        <div class="panel-card-body">
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
            ${agents.map(a => `
              <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-L1); border: 1px solid var(--border-subtle); border-radius: 8px;">
                <div style="width: 10px; height: 10px; border-radius: 50%; background: ${a.color || 'var(--success)'}; box-shadow: 0 0 8px ${a.color || 'var(--success)'};"></div>
                <div style="flex: 1;">
                  <div style="font-size: 13px; font-weight: 500; color: var(--text-primary);">${a.name}</div>
                  <div style="font-size: 11px; color: var(--text-tertiary);">Online · Healthy</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    setStatus(campaigns.length > 0 ? t('multimodal_status_ready', 'Ready') : t('metric_idle', 'Idle'));
  }
  
  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const eventsToWatch = ['StatusChanged', 'PlanGenerated', 'AdDeployed', 'OptimizationApplied', 'AnomalyDetected'];
  const unsubs = eventsToWatch.map(ev => ctx.eventBus.subscribe(ev, paint));
  return () => { unsubs.forEach(u => { try { u(); } catch {} }) };
}

// ── Tab: FSM View ─────────────────────────────────────────────────

const TASK_STATUS_COLOR = {
  DONE:    'var(--success)',
  RUNNING: 'var(--accent-primary)',
  WAITING: 'var(--text-tertiary)',
  PENDING: 'var(--text-tertiary)',
  BLOCKED: 'var(--warning)',
  FAILED:  'var(--danger)',
  SKIPPED: 'var(--text-tertiary)',
};

/** Lay tasks out by dependency depth (each row = tasks runnable in parallel
 *  once their deps are done). Tasks with no deps land in row 0. */
function layoutTasksByDependencyDepth(tasks) {
  const byKey = new Map(tasks.map(t => [t.task_key, t]));
  const depth = new Map();
  const visiting = new Set();

  function depthOf(key) {
    if (depth.has(key)) return depth.get(key);
    if (visiting.has(key)) return 0; // dep cycle — break it
    visiting.add(key);
    const t = byKey.get(key);
    const deps = (t?.dependencies || []).filter(d => byKey.has(d));
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(depthOf));
    visiting.delete(key);
    depth.set(key, d);
    return d;
  }

  for (const t of tasks) depthOf(t.task_key);

  const rows = [];
  for (const t of tasks) {
    const d = depth.get(t.task_key) ?? 0;
    if (!rows[d]) rows[d] = [];
    rows[d].push(t);
  }
  return rows.filter(Boolean);
}

function summarizeTaskStatuses(tasks) {
  const counts = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

let lastFetchedDetailId = null;
let lastFetchedDetail = null;

async function fetchCampaignDetail(api, campaign_id) {
  if (!api?.getCampaign) return null;
  if (lastFetchedDetailId === campaign_id && lastFetchedDetail) {
    // Cache for the same campaign during a tight repaint loop, but
    // always refresh on the next interval poll (caller resets via
    // invalidateCampaignDetail).
    return lastFetchedDetail;
  }
  try {
    const resp = await api.getCampaign(campaign_id);
    if (resp?.success) {
      lastFetchedDetailId = campaign_id;
      lastFetchedDetail = resp.data;
      return resp.data;
    }
  } catch { /* best-effort */ }
  return null;
}
function invalidateCampaignDetail() {
  lastFetchedDetailId = null;
  lastFetchedDetail = null;
}

function renderFsm(panel) {
  let mounted = true;

  async function paint() {
    if (!mounted) return;
    await ensureCampaigns();
    const ctx = getCtx();
    const api = ctx.api;
    const orchestrator = ctx.orchestrator;
    const campaignsMap = orchestrator?.campaigns || new Map();
    // Sort by updated_at DESC (fallback to created_at) so the most recently
    // touched campaign sits on top — matches the Campaigns list page and
    // makes the list usable when names collide.
    const campaigns = Array.from(campaignsMap.values()).sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });

    if (campaigns.length === 0) {
      panel.innerHTML = `<div class="dag-empty"><p>${t('orch_no_campaigns', 'No campaigns yet.')}</p></div>`;
      return;
    }

    let activeCid = getActiveCid();
    if (!activeCid || !campaignsMap.has(activeCid)) {
      activeCid = resolveDefaultCid(campaigns);
      // Reflect the choice into the URL silently so all tabs (and a copied
      // link) stay consistent. Don't push history — first-paint default.
      router.setQuery({ cid: activeCid });
      invalidateCampaignDetail();
    }

    const currentCampaign = campaignsMap.get(activeCid);
    let currentNormStatus = currentCampaign.status;
    if (currentNormStatus && currentNormStatus.startsWith('LOOP_')) {
      currentNormStatus = 'OPTIMIZING';
    }

    // Pull real plans+tasks + token usage from the backend in parallel.
    const [detail, usageResp] = await Promise.all([
      fetchCampaignDetail(api, activeCid),
      api?.getCampaignUsage ? api.getCampaignUsage(activeCid).catch(() => null) : null,
    ]);
    if (!mounted) return;
    const plans = Array.isArray(detail?.plans) ? detail.plans : [];
    const latestPlan = plans.length
      ? plans.slice().sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
        )[0]
      : null;
    const tasks = latestPlan?.tasks || [];
    const taskRows = tasks.length ? layoutTasksByDependencyDepth(tasks) : [];
    const counts = summarizeTaskStatuses(tasks);
    const usage = usageResp?.success ? usageResp.data : null;

    panel.innerHTML = `
      <div class="fsm-layout">
        <div class="fsm-sidebar">
          <div class="menu-group-title">${t('orch_sidebar_title', 'Campaigns')}</div>
          ${campaigns.map(c => {
            const stamp = c.updated_at || c.created_at;
            const badgeCls = statusBadgeClass(c.status);
            return `
            <div class="fsm-sidebar-item ${c.campaign_id === activeCid ? 'active' : ''}" data-cid="${escapeHtml(c.campaign_id)}" title="${escapeHtml(c.campaign_id)}">
              <div class="fsm-sidebar-item-main">
                <div class="text-truncate" style="font-size: 12px; font-weight: var(--fw-medium);">${escapeHtml(c.name || c.campaign_id)}</div>
                <div class="tiny muted" style="display: flex; gap: 6px; margin-top: 2px;">
                  <code class="code-inline" style="font-size: 10px;">${shortId(c.campaign_id)}</code>
                  <span>·</span>
                  <span>${escapeHtml(fmtDateTime(stamp))}</span>
                </div>
              </div>
              <span class="status-badge ${badgeCls}">${escapeHtml(c.status || '—')}</span>
            </div>
          `;}).join('')}
        </div>
        <div class="fsm-canvas">
          <h3 class="fsm-canvas-title">${t('orch_fsm_title', 'State Machine')} — ${escapeHtml(currentCampaign.campaign_id)}</h3>
          <div class="fsm-nodes">
            ${CAMPAIGN_STATES.map((st, idx) => {
              const isActive = st === currentNormStatus;
              const isPast = CAMPAIGN_STATES.indexOf(currentNormStatus) > idx;
              const action = nodeActionFor(currentCampaign.status, st);
              const clickable = !!action && !isActive;
              const titleAttr = isActive
                ? t('orch_fsm_node_current', 'Current state')
                : (clickable
                    ? t('orch_fsm_node_clickable', 'Open intervention panel for {target}').replace('{target}', st)
                    : t('orch_fsm_node_disabled', 'System-driven; not directly user-actionable'));
              return `
                <div class="fsm-node ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}">
                  <button type="button"
                          class="fsm-node-box ${clickable ? 'actionable' : 'disabled'}"
                          data-target-status="${escapeHtml(st)}"
                          ${clickable ? '' : 'disabled aria-disabled="true"'}
                          title="${escapeHtml(titleAttr)}">${st}</button>
                  ${idx < CAMPAIGN_STATES.length - 1 ? `<div class="fsm-edge"></div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div class="fsm-details">
            <p class="muted tiny">${t('orch_fsm_hint', 'Orchestrator advances campaign state based on system events.')}</p>
            <p class="muted tiny">${t('orch_fsm_click_hint', 'Click PAUSED / MONITORING / COMPLETED to jump to manual intervention.')}</p>
            ${currentCampaign.status?.startsWith?.('LOOP_') ? `<p class="muted tiny">Current loop: ${currentCampaign.loop_count}</p>` : ''}
          </div>

          <div class="fsm-details" style="margin-top: 24px; border-top: 1px solid var(--border-subtle); padding-top: 16px; width: 100%;">
            <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 12px;">
              <h3 class="fsm-canvas-title" style="margin: 0;">${t('orch_cost_title', 'LLM Token Usage & Cost')}</h3>
              <span class="tiny muted">${t('orch_cost_estimated', 'estimated')}</span>
            </div>
            ${(!usage || usage.calls === 0) ? `
              <p class="muted tiny">
                ${t('orch_cost_empty', 'No LLM calls recorded for this campaign yet.')}
              </p>
            ` : `
              <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                <div style="flex:1; background: var(--bg-L1); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 6px;">
                  <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">${t('orch_cost_calls', 'Calls')}</div>
                  <div style="font-size:18px; font-family:ui-monospace,Menlo,monospace; color:var(--text-primary);">${usage.calls}</div>
                </div>
                <div style="flex:1; background: var(--bg-L1); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 6px;">
                  <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">${t('orch_cost_in_tokens', 'Input tokens')}</div>
                  <div style="font-size:18px; font-family:ui-monospace,Menlo,monospace; color:var(--text-primary);">${usage.input_tokens.toLocaleString()}</div>
                </div>
                <div style="flex:1; background: var(--bg-L1); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 6px;">
                  <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">${t('orch_cost_out_tokens', 'Output tokens')}</div>
                  <div style="font-size:18px; font-family:ui-monospace,Menlo,monospace; color:var(--text-primary);">${usage.output_tokens.toLocaleString()}</div>
                </div>
                <div style="flex:1; background: var(--bg-L1); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 6px;">
                  <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">${t('orch_cost_usd', 'Cost (USD)')}</div>
                  <div style="font-size:18px; font-family:ui-monospace,Menlo,monospace; color:var(--accent-primary);">$${usage.estimated_cost_usd.toFixed(4)}</div>
                </div>
                <div style="flex:1; background: var(--bg-L1); border: 1px solid var(--border-subtle); padding: 12px; border-radius: 6px;">
                  <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase;">${t('orch_cost_latency', 'Avg latency')}</div>
                  <div style="font-size:18px; font-family:ui-monospace,Menlo,monospace; color:var(--text-primary);">${usage.avg_latency_ms.toFixed(0)} ms</div>
                </div>
              </div>
              ${(usage.breakdown || []).length ? `
                <table class="attr-table" style="margin-bottom: 8px;">
                  <thead>
                    <tr>
                      <th>${t('orch_col_provider', 'Provider')}</th>
                      <th>${t('orch_col_model', 'Model')}</th>
                      <th class="num">${t('orch_cost_calls', 'Calls')}</th>
                      <th class="num">${t('orch_cost_in_tokens', 'Input')}</th>
                      <th class="num">${t('orch_cost_out_tokens', 'Output')}</th>
                      <th class="num">${t('orch_cost_usd', 'Cost (USD)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${usage.breakdown.map(b => `
                      <tr>
                        <td><code class="code-inline">${escapeHtml(b.provider)}</code></td>
                        <td><code class="code-inline">${escapeHtml(b.model)}</code></td>
                        <td class="num">${b.calls}</td>
                        <td class="num">${b.input_tokens.toLocaleString()}</td>
                        <td class="num">${b.output_tokens.toLocaleString()}</td>
                        <td class="num">$${b.estimated_cost_usd.toFixed(4)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : ''}
            `}
          </div>

          <div class="fsm-details" style="margin-top: 24px; border-top: 1px solid var(--border-subtle); padding-top: 16px; width: 100%;">
            <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 12px;">
              <h3 class="fsm-canvas-title" style="margin: 0;">${t('orch_subtask_dag', 'Subtask DAG')}</h3>
              ${tasks.length ? `
                <span class="tiny muted">
                  ${tasks.length} ${t('orch_tasks', 'tasks')}
                  ${Object.entries(counts).map(([s, n]) =>
                    `· <span style="color:${TASK_STATUS_COLOR[s] || 'var(--text-tertiary)'}">${s}:${n}</span>`
                  ).join(' ')}
                </span>
              ` : ''}
            </div>

            ${tasks.length === 0 ? `
              <p class="muted tiny">
                ${t('orch_dag_waiting', 'No subtasks yet. The Planner agent populates this once a plan is generated.')}
              </p>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${taskRows.map((row, idx) => `
                  <div style="display: flex; align-items: stretch; gap: 8px;">
                    <div class="tiny muted" style="min-width: 56px; align-self: center;">L${idx}</div>
                    <div style="flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px;">
                      ${row.map(taskNode => {
                        const color = TASK_STATUS_COLOR[taskNode.status] || 'var(--text-tertiary)';
                        const deps  = (taskNode.dependencies || []).join(', ') || '—';
                        const dur   = taskNode.started_at && taskNode.finished_at
                          ? Math.max(0, Math.round((new Date(taskNode.finished_at) - new Date(taskNode.started_at)) / 100) / 10) + 's'
                          : null;
                        // Find LLM usage for this agent_type from the by_agent breakdown
                        const agentUsage = (usage?.by_agent || []).find(a =>
                          a.agent_type === escapeHtml(taskNode.agent_type)
                        );
                        return `
                          <div style="border-left: 3px solid ${color}; background: var(--bg-L2); border-radius: 0 6px 6px 0; padding: 8px 10px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                              <code class="code-inline" style="font-size: 11px;">${escapeHtml(taskNode.task_key)}</code>
                              <span class="tiny" style="color:${color}; font-weight: var(--fw-medium);">${escapeHtml(taskNode.status)}</span>
                            </div>
                            <div style="font-size: 12px; font-weight: var(--fw-medium); margin-top: 4px;">
                              ${escapeHtml(taskNode.agent_type)}
                            </div>
                            <div class="tiny muted" style="margin-top: 2px;">
                              deps: <code class="code-inline" style="font-size: 10px;">${escapeHtml(deps)}</code>
                              ${dur ? ` · ${dur}` : ''}
                            </div>
                            ${agentUsage ? `
                              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-subtle);">
                                <div class="tiny" style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                                  <span style="color: var(--accent-primary); font-weight: var(--fw-medium);">🤖 ${escapeHtml(agentUsage.models?.join(', ') || '—')}</span>
                                </div>
                                <div class="tiny muted" style="display: flex; gap: 8px; flex-wrap: wrap;">
                                  <span title="Input tokens">📥 ${(agentUsage.input_tokens || 0).toLocaleString()}</span>
                                  <span title="Output tokens">📤 ${(agentUsage.output_tokens || 0).toLocaleString()}</span>
                                  <span title="Estimated cost" style="color: var(--accent-primary);">💰 $${(agentUsage.estimated_cost_usd || 0).toFixed(4)}</span>
                                </div>
                              </div>
                            ` : ''}
                            ${taskNode.error_message ? `
                              <div class="tiny" style="color: var(--danger); margin-top: 4px;" title="${escapeHtml(taskNode.error_message)}">
                                ${escapeHtml(taskNode.error_message.slice(0, 60))}…
                              </div>
                            ` : ''}
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
              <p class="muted tiny" style="margin-top: 12px;">
                ${t('orch_dag_legend', 'Each row groups tasks runnable in parallel (same dependency depth). Color = task status.')}
              </p>
            `}
          </div>
        </div>
      </div>
    `;

    panel.querySelectorAll('.fsm-sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        _setActiveCid(item.dataset.cid);
        paint();
      });
    });

    // Clickable state nodes → jump to Alerts tab pre-filled with the
    // requested transition. The Alerts tab reads ?intent=transition:X on
    // paint, highlights the matching action button, and clears the param.
    panel.querySelectorAll('.fsm-node-box.actionable').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.targetStatus;
        if (!target) return;
        router.setQuery({ intent: `transition:${target}` });
        frame?.renderTab('alerts');
      });
    });
  }

  paint();

  const ctx = getCtx();
  let unsubs = [];
  if (ctx.eventBus) {
    const eventsToWatch = ['StatusChanged', 'PlanGenerated', 'AdDeployed', 'OptimizationApplied', 'AnomalyDetected'];
    unsubs = eventsToWatch.map(ev => ctx.eventBus.subscribe(ev, () => {
      invalidateCampaignDetail();
      paint();
    }));
  }
  // Refresh detail every 5s — task status changes between PENDING/RUNNING/DONE
  // are written by the worker after the graph finishes, so a poll catches them
  // even if no bus event triggered a repaint.
  const timer = setInterval(() => {
    invalidateCampaignDetail();
    paint();
  }, 5000);

  return () => {
    mounted = false;
    unsubs.forEach(u => { try { u(); } catch {} });
    clearInterval(timer);
  };
}

// ── Tab: Memory ───────────────────────────────────────────────────
// "12m ago" style formatting for memory timestamps. Falls back to local
// date string for anything older than ~7 days.
function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 45)              return 'just now';
  if (sec < 90)              return '1m ago';
  const min = Math.round(sec / 60);
  if (min < 60)              return `${min}m ago`;
  const hr  = Math.round(min / 60);
  if (hr  < 24)              return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7)               return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Derive a per-agent status snapshot from the campaign's execution trace.
// An agent is RUNNING if any of its tasks is in active_tasks; otherwise its
// state reflects the outcome of its most recent trace entry.
function deriveAgentStates(campaign) {
  const trace = Array.isArray(campaign?.trace) ? campaign.trace : [];
  const active = new Set(campaign?.active_tasks || []);
  const latest = new Map(); // agentType -> last trace entry
  for (const tr of trace) {
    if (!tr?.agentType) continue;
    latest.set(tr.agentType, tr);
  }
  const states = {};
  for (const [agentType, tr] of latest) {
    if (active.has(tr.taskId))   states[agentType] = 'RUNNING';
    else if (tr.error)           states[agentType] = 'ERROR';
    else if (tr.output != null)  states[agentType] = 'COMPLETED';
    else                         states[agentType] = 'IDLE';
  }
  return states;
}

function buildStateTree(campaign) {
  const trace = Array.isArray(campaign?.trace) ? campaign.trace : [];
  const lastTraceAt = trace.length ? trace[trace.length - 1].timestamp : null;
  return {
    campaign_id: campaign?.campaign_id || null,
    status:      campaign?.status || null,
    loop_count:  campaign?.loop_count || 0,
    budget:      campaign?.budget || null,
    kpi:         campaign?.kpi || null,
    active_tasks: campaign?.active_tasks || [],
    agent_states: deriveAgentStates(campaign),
    trace_entries: trace.length,
    last_trace_at: lastTraceAt ? new Date(lastTraceAt).toISOString() : null,
  };
}

function renderMemory(panel) {
  async function paint() {
    await ensureCampaigns();
    const campaignsMap = getCtx().orchestrator?.campaigns || new Map();
    const campaigns = Array.from(campaignsMap.values());

    if (campaigns.length === 0) {
      panel.innerHTML = `<div class="dag-empty"><p>${t('orch_no_campaigns', 'No campaigns yet.')}</p></div>`;
      return;
    }

    let activeCid = getActiveCid();
    if (!activeCid || !campaignsMap.has(activeCid)) {
      activeCid = resolveDefaultCid(campaigns);
      router.setQuery({ cid: activeCid });
    }

    const campaign = campaignsMap.get(activeCid) || {};
    const stateTree = buildStateTree(campaign);
    const traceMissing = !Array.isArray(campaign.trace) || campaign.trace.length === 0;

    // Fetch real long-term memory entries (populated by optimizer.py loop).
    const api = getCtx().api;
    let memoryItems = [];
    let memoryError = null;
    if (api?.getCampaignMemory) {
      try {
        const resp = await api.getCampaignMemory(activeCid, { limit: 20 });
        if (resp?.success && Array.isArray(resp.data?.items)) {
          memoryItems = resp.data.items;
        } else if (!resp?.success) {
          memoryError = resp?.error || 'Failed to load memory';
        }
      } catch (e) {
        memoryError = e?.message || String(e);
      }
    }

    panel.innerHTML = `
      <div style="padding: 0 0 16px 0; border-bottom: 1px solid var(--border-subtle); margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
        <span style="font-weight: 500; font-size: 14px;">${t('orch_select_campaign', 'Select Campaign:')}</span>
        <select class="modal-input" id="memory-campaign-select" style="width: 240px;">
          ${campaigns.map(c => `
            <option value="${escapeHtml(c.campaign_id)}" ${c.campaign_id === activeCid ? 'selected' : ''}>
              ${escapeHtml(c.name || c.campaign_id)}
            </option>
          `).join('')}
        </select>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div class="panel-card">
          <header class="panel-card-head">
            <h3>${t('orch_state_tree', 'LangGraph State Inspector')}</h3>
          </header>
          <div class="panel-card-body">
            ${traceMissing ? `
              <p class="muted" style="font-size: 12px; margin: 0 0 12px 0;">
                ${t('orch_state_no_trace', 'No in-session execution trace yet — agent_states will populate once this campaign runs through the Orchestrator in the current browser session.')}
              </p>
            ` : ''}
            <pre style="background: var(--bg-L2); padding: 16px; border-radius: 8px; font-size: 12px; overflow-x: auto; color: var(--text-secondary); border: 1px solid var(--border-subtle);"><code>${escapeHtml(JSON.stringify(stateTree, null, 2))}</code></pre>
          </div>
        </div>

        <div class="panel-card">
          <header class="panel-card-head">
            <h3>${t('orch_optimization_memory', 'pgvector Optimization Memory')}</h3>
          </header>
          <div class="panel-card-body" style="display: flex; flex-direction: column; gap: 12px;">
            ${memoryError ? `
              <div style="background: #fee2e2; color: #b91c1c; padding: 12px; border-radius: 8px; font-size: 12px;">
                ${escapeHtml(memoryError)}
              </div>
            ` : ''}
            ${memoryItems.length === 0 && !memoryError ? `
              <div class="dag-empty" style="padding: 24px;">
                <p class="muted" style="font-size: 13px; margin: 0;">
                  ${t('orch_memory_empty', 'No long-term memory yet. Entries are written by the optimizer agent on each loop that produces an AI insight.')}
                </p>
              </div>
            ` : ''}
            ${memoryItems.map(m => {
              const md = m.metadata || {};
              const actions = Array.isArray(md.actions) ? md.actions : [];
              const loopLabel = (md.loop !== undefined && md.loop !== null) ? `Loop #${md.loop}` : '';
              const absTime = m.created_at ? new Date(m.created_at).toLocaleString() : '';
              const relTime = formatRelativeTime(m.created_at);
              return `
              <div style="background: var(--bg-L2); padding: 16px; border-radius: 8px; border: 1px solid var(--border-subtle); display: flex; gap: 12px;">
                <span style="font-size: 16px;">💡</span>
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
                    ${loopLabel ? `<span class="cred-status-sandbox" style="font-size: 10px;">${escapeHtml(loopLabel)}</span>` : ''}
                    <span class="muted" style="font-size: 11px;" title="${escapeHtml(absTime)}">${escapeHtml(relTime)}</span>
                  </div>
                  <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5; white-space: pre-wrap; word-break: break-word;">${escapeHtml(m.content || '')}</div>
                  ${actions.length ? `
                    <div style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">
                      ${actions.map(a => `<span style="background: var(--bg-L1); border: 1px solid var(--border-subtle); padding: 2px 8px; border-radius: 999px; font-size: 11px; color: var(--text-secondary);">${escapeHtml(String(a))}</span>`).join('')}
                    </div>
                  ` : ''}
                  ${m.metadata ? `
                    <details style="margin-top: 8px;">
                      <summary class="muted" style="font-size: 11px; cursor: pointer;">${t('orch_memory_details', 'details')}</summary>
                      <pre style="background: var(--bg-L1); padding: 8px; border-radius: 6px; font-size: 11px; margin: 6px 0 0 0; overflow-x: auto;"><code>${escapeHtml(JSON.stringify(m.metadata, null, 2))}</code></pre>
                    </details>
                  ` : ''}
                </div>
              </div>
            `;}).join('')}
          </div>
        </div>
      </div>
    `;

    const select = panel.querySelector('#memory-campaign-select');
    if (select) {
      select.addEventListener('change', (e) => {
        _setActiveCid(e.target.value);
        paint();
      });
    }
  }

  let mounted = true;
  const safePaint = () => { if (mounted) paint(); };
  paint();

  // Auto-refresh: redraw when optimizer writes a new insight or status flips,
  // and a slow 30s poll catches the case where backend events fire while the
  // tab was hidden (BroadcastChannel missed deliveries, etc).
  const ctx = getCtx();
  const unsubs = [];
  if (ctx.eventBus) {
    ['OptimizationApplied', 'StatusChanged', 'AdDeployed'].forEach(ev => {
      unsubs.push(ctx.eventBus.subscribe(ev, safePaint));
    });
  }
  const poll = setInterval(safePaint, 30000);

  return () => {
    mounted = false;
    clearInterval(poll);
    unsubs.forEach(u => { try { u(); } catch {} });
  };
}

// ── Tab: Alerts ───────────────────────────────────────────────────
// Real backend-event-driven alerts panel. Replaces the prior mock that
// just filtered campaigns by status. We:
//   * Aggregate AnomalyDetected events from /v1/campaigns/:id/events for
//     each recent campaign (capped to keep network cost bounded).
//   * Pull the same events from the in-browser bus too so live anomalies
//     show up immediately without a page refresh.
//   * Wire the Pause / Resume / Complete / Cancel buttons to the real
//     api.pauseCampaign / resumeCampaign / completeCampaign / deleteCampaign
//     endpoints with status-aware enable/disable.

const PAUSEABLE   = new Set(['DEPLOYED','MONITORING','OPTIMIZING']);
const RESUMABLE   = new Set(['PAUSED']);
const COMPLETABLE = new Set(['MONITORING','OPTIMIZING','PAUSED']);
const isPauseable   = s => PAUSEABLE.has(s)   || (typeof s === 'string' && s.startsWith('LOOP_'));
const isResumable   = s => RESUMABLE.has(s);
const isCompletable = s => COMPLETABLE.has(s) || (typeof s === 'string' && s.startsWith('LOOP_'));

async function fetchAnomaliesForCampaign(api, campaign_id) {
  if (!api?.getCampaignEvents) return [];
  try {
    const resp = await api.getCampaignEvents(campaign_id);
    if (resp?.success && Array.isArray(resp.data?.events)) {
      return resp.data.events
        .filter(e => e.event_type === 'AnomalyDetected')
        .map(e => ({ ...e, campaign_id }));
    }
  } catch { /* best-effort */ }
  return [];
}

function renderAlerts(panel) {
  let mounted = true;

  async function paint() {
    if (!mounted) return;
    await ensureCampaigns();
    const ctx = getCtx();
    const api = ctx.api;
    const campaignsMap = ctx.orchestrator?.campaigns || new Map();
    const campaigns = Array.from(campaignsMap.values()).sort((a, b) => {
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });

    // --- Aggregate anomalies ----------------------------------------
    // 1. Backend events (durable) from the most recent N campaigns.
    const remoteAnomalies = (await Promise.all(
      campaigns.slice(0, 20).map(c => fetchAnomaliesForCampaign(api, c.campaign_id))
    )).flat();
    if (!mounted) return;

    // 2. In-browser bus history (catches live anomalies even before
    //    they hit /events from the WS bridge).
    const busAnomalies = (ctx.eventBus?.history || [])
      .filter(e => e.event_type === 'AnomalyDetected');

    const seen = new Map();
    [...remoteAnomalies, ...busAnomalies].forEach(e => {
      const key = e.id || `${e.campaign_id}|${e.occurred_at}|${e.payload?.metric}`;
      if (!seen.has(key)) seen.set(key, e);
    });
    const anomalies = Array.from(seen.values()).sort((a, b) =>
      String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''))
    );

    const pendingCampaigns = campaigns.filter(c => c.status === 'PENDING_REVIEW');

    // Use the shared selected campaign. If none in URL, fall back to the
    // most recent in-progress campaign — matches the prior behavior here.
    let activeCid = getActiveCid();
    if (!activeCid || !campaignsMap.has(activeCid)) {
      activeCid = resolveDefaultCid(campaigns, c =>
        !['COMPLETED','PAUSED','DRAFT'].includes(c.status)
      );
      if (activeCid) router.setQuery({ cid: activeCid });
    }
    const selected = campaigns.find(c => c.campaign_id === activeCid);
    const selectedStatus = selected?.status || '';

    panel.innerHTML = `
      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
        <div>
          <div class="panel-card" style="margin-bottom: 24px;">
            <header class="panel-card-head">
              <h3 style="color: var(--warning); display:flex; align-items:center; gap:6px;">
                ${icon('alert-circle', 'sm')} ${t('orch_pending_reviews', 'Pending Reviews')}
                <span class="tiny muted" style="font-weight: 400; margin-left: 4px;">(${pendingCampaigns.length})</span>
              </h3>
            </header>
            <div class="panel-card-body">
              ${pendingCampaigns.length === 0 ? `
                <p class="muted">${t('orch_no_pending', 'No campaigns awaiting review.')}</p>
                <p class="muted tiny" style="margin-top: 6px;">
                  ${t('orch_pending_hint', 'Reviewer agent runs autonomously inside the LangGraph pipeline; manual approval is rarely needed.')}
                </p>
              ` : `
                <table class="attr-table">
                  <thead>
                    <tr>
                      <th>${t('orch_col_campaign', 'Campaign')}</th>
                      <th>${t('orch_col_status', 'Status')}</th>
                      <th>${t('orch_col_updated', 'Updated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pendingCampaigns.map(c => `
                      <tr>
                        <td><code class="code-inline">${escapeHtml(c.campaign_id.slice(0, 12))}</code></td>
                        <td><span class="cred-status-sandbox">${escapeHtml(c.status)}</span></td>
                        <td class="tiny muted">${escapeHtml(fmtTime(c.updated_at || c.created_at))}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>

          <div class="panel-card">
            <header class="panel-card-head">
              <h3 style="color: var(--danger); display:flex; align-items:center; gap:6px;">
                ${icon('alert-triangle', 'sm')} ${t('orch_anomalies', 'Active Anomalies')}
                <span class="tiny muted" style="font-weight: 400; margin-left: 4px;">(${anomalies.length})</span>
              </h3>
            </header>
            <div class="panel-card-body">
              ${anomalies.length === 0 ? `
                <p class="muted">${t('orch_no_alerts', 'No anomalies detected.')}</p>
                <p class="muted tiny" style="margin-top: 6px;">
                  ${t('orch_anomalies_hint', 'AnomalyDetected events from the Analysis agent (CTR drop, ROAS below threshold, runaway spend, etc.) appear here in real time.')}
                </p>
              ` : `
                <table class="attr-table">
                  <thead>
                    <tr>
                      <th>${t('orch_col_when', 'When')}</th>
                      <th>${t('orch_col_campaign', 'Campaign')}</th>
                      <th>${t('orch_col_metric', 'Metric')}</th>
                      <th>${t('orch_col_severity', 'Severity')}</th>
                      <th>${t('orch_col_detail', 'Detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${anomalies.map(a => {
                      const sev = String(a.payload?.severity || '—').toUpperCase();
                      const sevColor = sev === 'HIGH'   ? 'var(--danger)'
                                     : sev === 'MEDIUM' ? 'var(--warning)'
                                     : 'var(--text-tertiary)';
                      return `
                        <tr data-anomaly-cid="${escapeHtml(a.campaign_id || '')}" style="cursor:pointer;">
                          <td class="tiny muted">${escapeHtml(fmtTime(a.occurred_at))}</td>
                          <td><code class="code-inline">${escapeHtml((a.campaign_id || '').slice(0, 12))}</code></td>
                          <td><code class="code-inline">${escapeHtml(a.payload?.metric || '—')}</code></td>
                          <td><span style="color:${sevColor}; font-weight: var(--fw-medium);">${escapeHtml(sev)}</span></td>
                          <td class="tiny" title="${escapeHtml(a.payload?.description || '')}">
                            ${escapeHtml((a.payload?.description || '').slice(0, 60) || '—')}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        </div>

        <div>
          <div class="panel-card">
            <header class="panel-card-head">
              <h3>${icon('settings', 'sm')} ${t('orch_interventions', 'Manual Interventions')}</h3>
            </header>
            <div class="panel-card-body">
              <p class="muted tiny" style="margin-bottom:12px;">
                ${t('orch_interv_hint', 'Force a state-machine transition on the selected campaign. All actions hit the real backend.')}
              </p>
              <select class="modal-input" id="orch-interv-select" style="width: 100%; margin-bottom: 12px;">
                ${campaigns.length === 0
                  ? `<option value="">${t('orch_interv_empty', 'No campaigns available')}</option>`
                  : campaigns.map(c => `
                      <option value="${escapeHtml(c.campaign_id)}" ${c.campaign_id === activeCid ? 'selected' : ''}>
                        ${escapeHtml((c.campaign_id || '').slice(0,8))} · ${escapeHtml(c.status || '—')} · ${escapeHtml((c.name || c.goal || '').slice(0,28))}
                      </option>
                    `).join('')}
              </select>
              <div class="tiny muted" style="margin-bottom: 12px;">
                ${t('orch_interv_status', 'Selected status:')}
                <code class="code-inline">${escapeHtml(selectedStatus || '—')}</code>
              </div>
              <div style="display:flex; flex-direction:column; gap:8px;">
                <button class="btn btn-secondary" id="orch-act-pause"    ${isPauseable(selectedStatus)   ? '' : 'disabled'}>
                  ${icon('pause', 'sm')} ${t('orch_btn_pause', 'Pause')}
                </button>
                <button class="btn btn-secondary" id="orch-act-resume"   ${isResumable(selectedStatus)   ? '' : 'disabled'}>
                  ${icon('play', 'sm')} ${t('orch_btn_resume', 'Resume')}
                </button>
                <button class="btn btn-secondary" id="orch-act-complete" ${isCompletable(selectedStatus) ? '' : 'disabled'}>
                  ${icon('check', 'sm')} ${t('orch_btn_complete', 'Mark complete')}
                </button>
                <button class="btn btn-secondary" id="orch-act-cancel"   style="color:var(--danger); border-color:color-mix(in srgb, var(--danger) 35%, transparent);" ${activeCid ? '' : 'disabled'}>
                  ${icon('trash', 'sm')} ${t('orch_btn_cancel', 'Delete campaign')}
                </button>
              </div>
              <div id="orch-interv-feedback" class="tiny" style="margin-top: 12px; min-height: 16px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // --- Bind interactions ------------------------------------------
    panel.querySelectorAll('tr[data-anomaly-cid]').forEach(tr => {
      tr.addEventListener('click', () => {
        const cid = tr.dataset.anomalyCid;
        if (!cid) return;
        _setActiveCid(cid);
        paint();
      });
    });

    panel.querySelector('#orch-interv-select')?.addEventListener('change', (e) => {
      _setActiveCid(e.target.value);
      paint();
    });

    const fb = panel.querySelector('#orch-interv-feedback');
    const setFb = (msg, kind = 'muted') => {
      if (!fb) return;
      const color = kind === 'success' ? 'var(--success)' : kind === 'error' ? 'var(--danger)' : 'var(--text-tertiary)';
      fb.style.color = color;
      fb.textContent = msg;
    };

    const runAction = async (label, fn, optimisticStatus) => {
      if (!activeCid) return;
      setFb(`${label}…`);
      try {
        const resp = await fn();
        if (!resp?.success) throw new Error(resp?.error || `${label} failed`);
        // Optimistic: update local map so the next paint reflects it
        // even before WS pushes a StatusChanged event.
        if (optimisticStatus) {
          const map = ctx.orchestrator?.campaigns;
          const entry = map?.get?.(activeCid);
          if (entry) { entry.status = optimisticStatus; map.set(activeCid, entry); }
        }
        setFb(`${label} ${t('orch_action_ok', 'OK')}`, 'success');
        await paint();
      } catch (e) {
        setFb(`${label} ${t('orch_action_fail', 'failed')}: ${e.message || e}`, 'error');
      }
    };

    panel.querySelector('#orch-act-pause')?.addEventListener('click', () =>
      runAction(t('orch_btn_pause', 'Pause'),
                () => api.pauseCampaign(activeCid),
                'PAUSED')
    );
    panel.querySelector('#orch-act-resume')?.addEventListener('click', () =>
      runAction(t('orch_btn_resume', 'Resume'),
                () => api.resumeCampaign(activeCid),
                'MONITORING')
    );
    panel.querySelector('#orch-act-complete')?.addEventListener('click', () =>
      runAction(t('orch_btn_complete', 'Mark complete'),
                () => api.completeCampaign(activeCid),
                'COMPLETED')
    );
    panel.querySelector('#orch-act-cancel')?.addEventListener('click', async () => {
      if (!activeCid) return;
      const ok = window.confirm(
        t('orch_btn_cancel_confirm', 'Permanently delete this campaign and all its data?')
      );
      if (!ok) return;
      const cidToDelete = activeCid;
      setFb(`${t('orch_btn_cancel', 'Deleting')}…`);
      try {
        const resp = await api.deleteCampaign(cidToDelete);
        if (!resp?.success && !/404/.test(String(resp?.error || ''))) {
          throw new Error(resp?.error || 'delete failed');
        }
        ctx.orchestrator?.campaigns?.delete?.(cidToDelete);
        _setActiveCid(null);
        setFb(t('orch_action_deleted', 'Deleted.'), 'success');
        await paint();
      } catch (e) {
        setFb(`${t('orch_btn_cancel', 'Delete')} ${t('orch_action_fail', 'failed')}: ${e.message || e}`, 'error');
      }
    });

    // ── Consume ?intent=transition:TARGET sent from FSM node click ──
    // Highlight the matching action button, scroll the panel into view,
    // and clear the param so a later page reload doesn't re-trigger it.
    const intent = router.getQuery().intent;
    const m = /^transition:(.+)$/.exec(intent || '');
    if (m) {
      router.setQuery({ intent: null });
      const target = m[1];
      const btnId = target === 'PAUSED'    ? '#orch-act-pause'
                  : target === 'MONITORING' ? '#orch-act-resume'
                  : target === 'COMPLETED'  ? '#orch-act-complete'
                  : null;
      const targetBtn = btnId ? panel.querySelector(btnId) : null;
      const intervSelect = panel.querySelector('#orch-interv-select');
      if (intervSelect) intervSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (targetBtn && !targetBtn.disabled) {
        targetBtn.classList.add('intent-flash');
        try { targetBtn.focus({ preventScroll: true }); } catch {}
        setTimeout(() => targetBtn.classList.remove('intent-flash'), 2400);
        setFb(t('orch_intent_prompt', 'Confirm to ') + (m[1]), 'muted');
      } else if (targetBtn?.disabled) {
        setFb(
          t('orch_intent_blocked', 'Cannot transition to {target} from current status.').replace('{target}', target),
          'error'
        );
      }
    }
  }

  paint();

  const ctx = getCtx();
  let unsubs = [];
  if (ctx.eventBus) {
    unsubs = ['StatusChanged', 'AnomalyDetected'].map(ev => ctx.eventBus.subscribe(ev, paint));
  }
  // Backend-driven anomalies might arrive before any WS subscription is
  // open for that campaign — poll every 8s as a fallback.
  const timer = setInterval(paint, 8000);

  return () => {
    mounted = false;
    unsubs.forEach(u => { try { u(); } catch {} });
    clearInterval(timer);
  };
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
    const events = getCtx().eventBus?.history || [];
    panel.innerHTML = `
      <div class="logs-view full-height">
        ${events.length
          ? events.slice().reverse().map(e => {
              const u = e.payload?.llm_usage;
              const usageHtml = u ? `
                <span class="log-usage tiny" style="display: inline-flex; gap: 6px; align-items: center; padding: 1px 6px; background: color-mix(in srgb, var(--accent-primary) 10%, transparent); border-radius: 4px; margin-left: 4px;">
                  <span style="color: var(--accent-primary); font-weight: 500;">🤖 ${escapeHtml((u.models || []).join(', ') || '—')}</span>
                  <span>📥${(u.input_tokens || 0).toLocaleString()}</span>
                  <span>📤${(u.output_tokens || 0).toLocaleString()}</span>
                  <span style="color: var(--accent-primary);">💰$${(u.estimated_cost_usd || 0).toFixed(4)}</span>
                </span>
              ` : '';
              return `
                <div class="log-line">
                  <span class="log-time">${fmtTime(e.occurred_at)}</span>
                  <span class="log-type">${e.event_type}</span>
                  <span class="log-msg">${escapeHtml(e.campaign_id || 'system')}</span>
                  ${usageHtml}
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
        { id: 'memory',   labelKey: 'orch_tab_memory',     label: 'Learnings',    icon: 'database',     render: renderMemory },
        { id: 'alerts',   labelKey: 'orch_tab_alerts',     label: 'Alerts & HITL',icon: 'alert-triangle',render: renderAlerts },
        { id: 'logs',     labelKey: 'agent_tab_logs',      label: 'Logs',         icon: 'align-left',   render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
    campaignsLastFetched = 0;
    campaignsInflight = null;
  },
};
