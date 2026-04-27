/*
 * Campaigns Page — /campaigns
 *
 * Lists every campaign with an inline expandable data-flow trace:
 *   - One row per campaign (header: id, name, status, budget, kpi, loops, goal)
 *   - Click row → expands a per-agent timeline:
 *       • In-browser campaigns: rows from orchestrator.campaign.trace[]
 *         (full input / output / error / timestamp + downstream events)
 *       • Backend campaigns: synthesized from eventBus.history filtered by
 *         campaign_id (input/output coarse, but the agent name + payload
 *         is enough to read the data flow).
 *
 * Spec: docs/frontend/12-campaigns-page-spec.md (revised 2026-04-27)
 */

import { i18n }   from '../../i18n/index.js';
import { icon }   from '../icons.js';
import { router } from '../router.js';

function getCtx() { return window.OAG || {}; }
function t(k, d)  { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function trunc(str = '', n = 80) {
  const s = String(str);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Map event types to which agent published them — used when no trace exists. */
const EVENT_AGENT_MAP = {
  PlanGenerated:        { agent: 'PLANNER',      direction: 'out' },
  StrategyDecided:      { agent: 'STRATEGY',     direction: 'out' },
  ContentGenerated:     { agent: 'CONTENT_GEN',  direction: 'out' },
  AssetsGenerated:      { agent: 'MULTIMODAL',   direction: 'out' },
  ContentApproved:      { agent: 'REVIEWER',     direction: 'out' },
  AdDeployed:           { agent: 'CHANNEL_EXEC', direction: 'out' },
  ReportGenerated:      { agent: 'ANALYSIS',     direction: 'out' },
  AnomalyDetected:      { agent: 'ANALYSIS',     direction: 'out' },
  OptimizationApplied:  { agent: 'OPTIMIZER',    direction: 'out' },
  StatusChanged:        { agent: 'ORCHESTRATOR', direction: 'control' },
};

/** Build a unified flow timeline for a campaign, regardless of source. */
function buildCampaignFlow(campaign, eventBus) {
  const flow = [];

  // 1) In-browser trace from Orchestrator.executePlan
  if (Array.isArray(campaign?.trace) && campaign.trace.length) {
    for (const tr of campaign.trace) {
      flow.push({
        kind:      'trace',
        agent:     tr.agentType || 'UNKNOWN',
        taskId:    tr.taskId,
        timestamp: tr.timestamp ? new Date(tr.timestamp).toISOString() : null,
        input:     tr.input,
        output:    tr.output,
        error:     tr.error || null,
      });
    }
  }

  // 2) Events published for this campaign (covers backend campaigns too)
  const cid = campaign?.campaign_id || campaign?.id;
  const events = (eventBus?.history || []).filter(e => e.campaign_id === cid);
  for (const ev of events) {
    const meta = EVENT_AGENT_MAP[ev.event_type] || { agent: '—', direction: 'out' };
    flow.push({
      kind:      'event',
      agent:     meta.agent,
      direction: meta.direction,
      eventType: ev.event_type,
      timestamp: ev.occurred_at,
      payload:   ev.payload,
    });
  }

  // Sort chronologically; ISO and ms-stamp both compare consistently as strings
  // here because trace entries we converted to ISO too.
  flow.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  return flow;
}

function renderFlowEntry(entry) {
  const agentBadge = `<span class="cf-agent" data-agent="${escapeHtml(entry.agent)}">${escapeHtml(entry.agent)}</span>`;
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })
    : '—';

  if (entry.kind === 'trace') {
    const inJson = entry.input ? JSON.stringify(entry.input, null, 2) : '';
    const outJson = entry.output ? JSON.stringify(entry.output, null, 2) : '';
    return `
      <div class="cf-entry ${entry.error ? 'cf-entry-error' : ''}">
        <header class="cf-entry-head">
          ${agentBadge}
          <span class="cf-task tiny muted">${t('cf_task', 'task')} ${escapeHtml(entry.taskId || '—')}</span>
          <span class="cf-kind tiny">${t('cf_kind_run', 'agent run')}</span>
          <span class="cf-time tiny muted">${time}</span>
        </header>
        <div class="cf-entry-body">
          <div class="cf-io">
            <div class="cf-io-label">${t('cf_input', 'Input / Received')}</div>
            <pre class="cf-pre">${escapeHtml(inJson || '—')}</pre>
          </div>
          <div class="cf-io">
            <div class="cf-io-label">${t('cf_output', 'Output / Result')}</div>
            ${entry.error
              ? `<pre class="cf-pre cf-pre-error">${escapeHtml(entry.error)}</pre>`
              : `<pre class="cf-pre">${escapeHtml(outJson || '—')}</pre>`}
          </div>
        </div>
      </div>
    `;
  }

  // event
  const payload = entry.payload ? JSON.stringify(entry.payload, null, 2) : '';
  return `
    <div class="cf-entry cf-entry-event">
      <header class="cf-entry-head">
        ${agentBadge}
        <span class="cf-event tiny">${escapeHtml(entry.eventType)}</span>
        <span class="cf-kind tiny">${t('cf_kind_event', 'event published')}</span>
        <span class="cf-time tiny muted">${time}</span>
      </header>
      <div class="cf-entry-body">
        <div class="cf-io cf-io-full">
          <div class="cf-io-label">${t('cf_payload', 'Payload')}</div>
          <pre class="cf-pre">${escapeHtml(payload || '—')}</pre>
        </div>
      </div>
    </div>
  `;
}

function renderCampaignRow(c, flow) {
  const cid = c.campaign_id || c.id;
  const goal = c.goal || c.name || '—';
  const status = c.status || '—';
  const budget = c.budget?.total
    ? `${c.budget?.currency || ''} ${c.budget.total}`.trim()
    : '—';
  const kpi = c.kpi?.metric
    ? `${c.kpi.metric}${c.kpi?.target != null ? ' ' + c.kpi.target : ''}`
    : '—';
  const loops = c.loop_count ?? 0;

  const lastFlowAt = flow.length ? flow[flow.length - 1].timestamp : null;

  return `
    <article class="campaign-row" data-campaign-id="${escapeHtml(cid)}">
      <header class="campaign-row-head">
        <button class="campaign-row-toggle" data-toggle="${escapeHtml(cid)}"
                aria-expanded="false" aria-controls="cf-${escapeHtml(cid)}">
          ${icon('chevron-down', 'sm')}
        </button>
        <a class="campaign-row-id code-inline" href="#/campaigns/${encodeURIComponent(cid)}">
          ${escapeHtml(cid)}
        </a>
        <div class="campaign-row-name" title="${escapeHtml(goal)}">${escapeHtml(trunc(goal, 60))}</div>
        <span class="cred-status-sandbox">${escapeHtml(status)}</span>
        <span class="campaign-row-budget num">${escapeHtml(budget)}</span>
        <span class="campaign-row-kpi">${escapeHtml(kpi)}</span>
        <span class="campaign-row-loops num">${loops}</span>
        <span class="campaign-row-last tiny muted">${fmtTime(lastFlowAt)}</span>
      </header>
      <section class="campaign-flow" id="cf-${escapeHtml(cid)}" hidden>
        <div class="campaign-flow-meta">
          <span class="tiny">${t('cf_meta_count', '{n} steps').replace('{n}', flow.length)}</span>
          <span class="tiny muted">${t('cf_meta_legend', 'agent run = orchestrator-driven · event published = published to bus')}</span>
        </div>
        ${flow.length
          ? flow.map(renderFlowEntry).join('')
          : `<p class="muted tiny">${t('cf_empty', 'No execution data yet — once Orchestrator dispatches tasks or any agent publishes an event, it will appear here.')}</p>`}
      </section>
    </article>
  `;
}

function wireRowToggles(scope) {
  scope.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.toggle;
      const panel = scope.querySelector(`#cf-${CSS.escape(cid)}`);
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (panel) panel.hidden = expanded;
      btn.closest('.campaign-row')?.classList.toggle('expanded', !expanded);
    });
  });
}

let unsub = null;

export default {
  titleKey: 'page_campaigns_title',

  async mount(outlet) {
    const ctx = getCtx();
    const orchestrator = ctx.orchestrator;
    const api = ctx.api;
    const eventBus = ctx.eventBus;

    async function paint() {
      const localCampaigns = Array.from((orchestrator?.campaigns || new Map()).values());

      let remoteCampaigns = [];
      try {
        const resp = await api?.listCampaigns?.();
        if (resp?.success && Array.isArray(resp.data?.items)) {
          remoteCampaigns = resp.data.items;
        }
      } catch (e) {
        console.warn('[campaigns] Failed to fetch remote campaigns', e);
      }

      // Merge — prefer local (has trace); fall back to remote.
      const merged = new Map();
      remoteCampaigns.forEach(c => merged.set(c.id || c.campaign_id, c));
      localCampaigns.forEach(c => {
        const id = c.campaign_id || c.id;
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...c } : c);
      });

      const campaigns = Array.from(merged.values())
        .map(c => ({ ...c, campaign_id: c.campaign_id || c.id }))
        .reverse(); // newest first (assumes id encodes timestamp)

      const hasCampaigns = campaigns.length > 0;
      // Pre-build flows so we know step counts in the header.
      const rows = campaigns.map(c => renderCampaignRow(c, buildCampaignFlow(c, eventBus)));

      outlet.innerHTML = `
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="#/">${t('nav_hub', 'Hub')}</a>
          ${icon('chevron-right', 'sm')}
          <span class="breadcrumb-current">${t('nav_campaigns', 'Campaigns')}</span>
        </nav>

        <header class="section-header">
          <h1 tabindex="-1">${t('page_campaigns_title', 'Campaigns')}</h1>
          <p>${t('campaigns_sub_flow', 'Each row expands into the per-agent data flow: what each agent received, executed, and where the result was sent.')}</p>
        </header>

        ${!hasCampaigns ? `
          <div class="dag-empty">
            <p>${t('orch_no_campaigns', 'No campaigns yet. Launch one from Hub.')}</p>
          </div>
        ` : `
          <header class="campaign-row-headings">
            <span></span>
            <span>${t('campaigns_col_id', 'ID')}</span>
            <span>${t('campaigns_col_goal', 'Goal')}</span>
            <span>${t('orch_col_status', 'Status')}</span>
            <span class="num">${t('campaigns_col_budget', 'Budget')}</span>
            <span>${t('campaigns_col_kpi', 'KPI')}</span>
            <span class="num">${t('orch_col_loops', 'Loops')}</span>
            <span>${t('campaigns_col_last', 'Last activity')}</span>
          </header>
          <section class="campaign-list">
            ${rows.join('')}
          </section>
        `}
      `;

      wireRowToggles(outlet);
    }

    await paint();

    // Live updates for the in-browser path. For backend campaigns, repaint
    // happens whenever WS bridges any event into the in-browser eventBus.
    if (eventBus) {
      unsub = eventBus.subscribe('*', () => paint());
    }
  },

  unmount() {
    if (unsub) { try { unsub(); } catch {} unsub = null; }
  },
};
