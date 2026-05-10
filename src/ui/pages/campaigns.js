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
  CampaignCreated:      { agent: 'ORCHESTRATOR', direction: 'control' },
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

/** Localized event type display names. */
function eventTypeLabel(eventType) {
  return t(`evt_${eventType}`, eventType);
}

/** Build a unified flow timeline for a campaign, regardless of source.
 *  Sources merged (deduped by event id):
 *    1. Orchestrator.executePlan in-browser trace[]
 *    2. eventBus.history filtered by campaign_id (in-browser + WS-mirrored)
 *    3. Optional `remoteEvents` fetched from backend /v1/campaigns/:id/events
 */
function buildCampaignFlow(campaign, eventBus, remoteEvents = []) {
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

  // 2 + 3) Events — merge bus + backend, dedupe by id.
  const cid = campaign?.campaign_id || campaign?.id;
  const seen = new Map();
  const localBus = (eventBus?.history || []).filter(e => e.campaign_id === cid);
  [...remoteEvents, ...localBus].forEach(ev => {
    const id = ev.id || `${ev.event_type}|${ev.occurred_at}`;
    if (!seen.has(id)) seen.set(id, ev);
  });
  for (const ev of seen.values()) {
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

  // event — instead of always dumping JSON, render the meaningful payload
  // shape inline (variants as cards, asset URLs as <img>, plan tasks as a
  // list, metrics as a small grid, etc.). Fall back to JSON for unknown shapes.
  const rich = renderEventPayload(entry.eventType, entry.payload);
  const rawJson = entry.payload ? JSON.stringify(entry.payload, null, 2) : '';
  return `
    <div class="cf-entry cf-entry-event">
      <header class="cf-entry-head">
        ${agentBadge}
        <span class="cf-event tiny">${escapeHtml(eventTypeLabel(entry.eventType))}</span>
        <span class="cf-kind tiny">${t('cf_kind_event', 'event published')}</span>
        <span class="cf-time tiny muted">${time}</span>
      </header>
      <div class="cf-entry-body">
        <div class="cf-io cf-io-full">
          ${rich}
          <details class="cf-raw">
            <summary class="tiny muted">${t('cf_payload_raw', 'Raw payload')}</summary>
            <pre class="cf-pre">${escapeHtml(rawJson || '—')}</pre>
          </details>
        </div>
      </div>
    </div>
  `;
}

// Per-event-type rich rendering. Returns HTML; pure functions, no side effects.
function renderEventPayload(eventType, payload) {
  if (!payload || typeof payload !== 'object') return '';

  switch (eventType) {
    case 'PlanGenerated': {
      const tasks = payload.plan?.tasks || [];
      if (!tasks.length) return '';
      return `
        <div class="cf-io-label">${t('cf_plan_tasks', 'Plan tasks')} <span class="muted">(${tasks.length})</span></div>
        <ul class="cf-task-list">
          ${tasks.map(tk => `
            <li class="cf-task-item">
              <code class="code-inline">${escapeHtml(tk.id || '—')}</code>
              <span class="cf-agent" data-agent="${escapeHtml(tk.agent_type || '')}">${escapeHtml(tk.agent_type || '—')}</span>
              <span class="tiny muted">deps: ${escapeHtml((tk.dependencies || []).join(', ') || '—')}</span>
            </li>
          `).join('')}
        </ul>
      `;
    }

    case 'StrategyDecided': {
      const cp = payload.strategy?.channel_plan || [];
      const reason = payload.strategy?.reasoning;
      return `
        ${cp.length ? `
          <div class="cf-io-label">${t('cf_channel_plan', 'Channel plan')}</div>
          <ul class="cf-task-list">
            ${cp.map(c => `
              <li class="cf-task-item">
                <code class="code-inline">${escapeHtml(c.channel || '—')}</code>
                <span class="tiny">${t('cf_budget', 'budget')}: ${c.budget?.toLocaleString?.() ?? c.budget ?? '—'}</span>
                ${c.bid_strategy ? `<span class="tiny muted">${escapeHtml(c.bid_strategy)}</span>` : ''}
                ${c.priority ? `<span class="tiny muted">${escapeHtml(c.priority)}</span>` : ''}
              </li>
            `).join('')}
          </ul>
        ` : ''}
        ${reason ? `
          <div class="cf-io-label" style="margin-top: var(--sp-2);">${t('cf_reasoning', 'Reasoning')}</div>
          <p class="cf-rationale">${escapeHtml(trunc(reason, 400))}</p>
        ` : ''}
      `;
    }

    case 'ContentGenerated': {
      const variants = payload.bundle?.variants || [];
      if (!variants.length) return '';
      return `
        <div class="cf-io-label">${t('cf_variants', 'Generated copy variants')} <span class="muted">(${variants.length})</span></div>
        <div class="cf-variant-grid">
          ${variants.map(v => `
            <div class="cf-variant-card">
              <header>
                <span class="cf-variant-label">${escapeHtml(v.variant_label || v.id || '—')}</span>
                ${v.channel ? `<span class="tiny muted">${escapeHtml(v.channel)}</span>` : ''}
              </header>
              ${v.title ? `<div class="cf-variant-title">${escapeHtml(v.title)}</div>` : ''}
              ${v.hook  ? `<div class="cf-variant-hook tiny muted">${escapeHtml(v.hook)}</div>` : ''}
              ${v.body  ? `<p class="cf-variant-body">${escapeHtml(trunc(v.body, 200))}</p>` : ''}
              ${v.cta   ? `<div class="cf-variant-cta">CTA: ${escapeHtml(v.cta)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    case 'AssetsGenerated': {
      // The agent_tasks broadcast wraps the assets dict in another `assets`
      // key (see event_map["multimodal"]); accept either shape.
      const inner = payload.assets?.assets || payload.assets || [];
      const list = Array.isArray(inner) ? inner : [];
      if (!list.length) return '';
      return `
        <div class="cf-io-label">${t('cf_assets', 'Generated assets')} <span class="muted">(${list.length})</span></div>
        <div class="cf-asset-grid">
          ${list.map(a => `
            <figure class="cf-asset">
              ${a.storage_url
                ? `<a href="${escapeHtml(a.storage_url)}" target="_blank" rel="noopener">
                     <img src="${escapeHtml(a.storage_url)}" alt="${escapeHtml(a.id || 'asset')}" loading="lazy" />
                   </a>`
                : `<div class="cf-asset-placeholder">no url</div>`}
              <figcaption class="tiny muted">
                ${escapeHtml(a.size || a.aspect_ratio || '')}
                ${a.visual_tool ? ` · ${escapeHtml(a.visual_tool)}` : ''}
              </figcaption>
            </figure>
          `).join('')}
        </div>
      `;
    }

    case 'AdDeployed': {
      const platforms = payload.platforms || [];
      const adIds = payload.ad_ids || payload.ad_campaign_ids || [];
      return `
        <div class="cf-io-label">${t('cf_deployed', 'Deployed to')}</div>
        <ul class="cf-task-list">
          ${platforms.map((p, i) => `
            <li class="cf-task-item">
              <code class="code-inline">${escapeHtml(p)}</code>
              ${adIds[i] ? `<span class="tiny muted">${escapeHtml(adIds[i])}</span>` : ''}
            </li>
          `).join('')}
        </ul>
      `;
    }

    case 'ReportGenerated': {
      const m = payload.metrics || {};
      const fields = [
        ['Impressions', m.impressions], ['Clicks', m.clicks], ['Conversions', m.conversions],
        ['Spend', m.spend], ['Revenue', m.revenue],
        ['CTR', m.ctr != null ? (m.ctr * 100).toFixed(2) + '%' : null],
        ['CVR', m.cvr != null ? (m.cvr * 100).toFixed(2) + '%' : null],
        ['ROAS', m.roas?.toFixed?.(2) ?? m.roas],
      ].filter(([_, v]) => v != null);
      return `
        <div class="cf-io-label">${t('cf_metrics', 'Metrics')}</div>
        <div class="cf-metric-grid">
          ${fields.map(([k, v]) => `
            <div class="cf-metric"><div class="tiny muted">${k}</div><div class="cf-metric-val">${escapeHtml(String(v))}</div></div>
          `).join('')}
        </div>
      `;
    }

    case 'OptimizationApplied': {
      const actions = payload.actions || [];
      if (!actions.length) return '';
      return `
        <div class="cf-io-label">${t('cf_actions', 'Optimizer actions')} · loop ${payload.loop_count ?? 0}</div>
        <ul class="cf-task-list">
          ${actions.map(a => `
            <li class="cf-task-item">
              <code class="code-inline">${escapeHtml(a.type || '—')}</code>
              ${a.params?.reason ? `<span class="tiny muted">${escapeHtml(trunc(a.params.reason, 120))}</span>` : ''}
            </li>
          `).join('')}
        </ul>
      `;
    }

    case 'AnomalyDetected':
      return `
        <div class="cf-io-label" style="color: var(--danger);">${t('cf_anomaly', 'Anomaly')}</div>
        <p>
          <code class="code-inline">${escapeHtml(payload.metric || '')}</code>
          ${payload.severity ? ` · <strong>${escapeHtml(payload.severity)}</strong>` : ''}
          ${payload.channel ? ` · ${escapeHtml(payload.channel)}` : ''}
          ${payload.description ? `<br/><span class="tiny muted">${escapeHtml(payload.description)}</span>` : ''}
        </p>
      `;

    case 'StatusChanged':
      return `
        <p>
          <code class="code-inline">${escapeHtml(payload.old_status || '—')}</code>
          → <code class="code-inline">${escapeHtml(payload.new_status || '—')}</code>
        </p>
      `;

    case 'ContentApproved':
      return payload.feedback ? `
        <div class="cf-io-label">${t('cf_review_feedback', 'Reviewer feedback')}</div>
        <p>${escapeHtml(trunc(payload.feedback, 400))}</p>
      ` : '';

    default:
      return '';
  }
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
        <a class="campaign-row-orchestrator" href="#/agents/orchestrator?cid=${encodeURIComponent(cid)}"
           title="${escapeHtml(t('campaigns_open_orchestrator', 'Open in Orchestrator'))}"
           aria-label="${escapeHtml(t('campaigns_open_orchestrator', 'Open in Orchestrator'))}">
          ${icon('git-merge', 'sm')}
        </a>
        <button class="campaign-row-delete" data-delete="${escapeHtml(cid)}"
                title="${escapeHtml(t('campaigns_delete_title', 'Delete campaign and all its data'))}"
                aria-label="${escapeHtml(t('campaigns_delete_title', 'Delete campaign'))}">
          ${icon('trash', 'sm')}
        </button>
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

function wireRowDeletes(scope, api, repaint) {
  scope.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const cid = btn.dataset.delete;
      const confirmMsg = t(
        'campaigns_delete_confirm',
        'Permanently delete this campaign and all its plans, events, content and analytics? This cannot be undone.'
      );
      if (!window.confirm(confirmMsg)) return;

      const row = btn.closest('.campaign-row');
      btn.disabled = true;
      row?.classList.add('deleting');

      try {
        const resp = await api?.deleteCampaign?.(cid);
        // Vite/FastAPI 204 returns no body — _request normalizes that as
        // { success: true, data: {} }. A 404 (already gone) is also fine.
        const ok = resp?.success || /404|not found/i.test(String(resp?.error || ''));
        if (!ok) throw new Error(resp?.error || 'delete failed');

        // Drop the in-browser orchestrator entry too so the row doesn't
        // resurrect on the next paint from local state.
        try {
          const orchestrator = window.OAG?.orchestrator;
          if (orchestrator?.deleteCampaign) {
            orchestrator.deleteCampaign(cid);
          } else if (orchestrator?.campaigns?.delete) {
            orchestrator.campaigns.delete(cid);
          }
        } catch {}

        await repaint();
      } catch (e) {
        console.error('[campaigns] delete failed', e);
        alert(t('campaigns_delete_failed', 'Delete failed: ') + (e?.message || e));
        btn.disabled = false;
        row?.classList.remove('deleting');
      }
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
      let remoteCampaigns = [];
      let fetchSuccess = false;
      try {
        const resp = await api?.listCampaigns?.();
        if (resp?.success && Array.isArray(resp.data?.items)) {
          remoteCampaigns = resp.data.items;
          fetchSuccess = true;
        }
      } catch (e) {
        console.warn('[campaigns] Failed to fetch remote campaigns', e);
      }

      // Automatic Sync: Prune local campaigns that are no longer on the backend
      if (fetchSuccess && orchestrator) {
        const remoteIds = new Set(remoteCampaigns.map(c => String(c.id || c.campaign_id)));
        orchestrator.campaigns.forEach((c, id) => {
          // If it looks like a backend campaign (UUID) but is missing from the remote list,
          // it was likely deleted from another client or before the last fix.
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
          if (isUuid && !remoteIds.has(id)) {
            console.log(`[campaigns] Auto-pruning stale local campaign: ${id}`);
            orchestrator.deleteCampaign(id);
          }
        });
      }

      const localCampaigns = Array.from((orchestrator?.campaigns || new Map()).values());

      // Merge — prefer local (has trace); fall back to remote.
      // Backend returns flat fields (budget_total / currency / kpi_metric /
      // kpi_target); normalize to the nested shape the row template reads.
      const normalizeRemote = (c) => ({
        ...c,
        budget: c.budget || (c.budget_total != null
          ? { total: c.budget_total, currency: c.currency }
          : undefined),
        kpi: c.kpi || (c.kpi_metric != null
          ? { metric: c.kpi_metric, target: c.kpi_target }
          : undefined),
      });
      const merged = new Map();
      remoteCampaigns.forEach(c => merged.set(c.id || c.campaign_id, normalizeRemote(c)));
      localCampaigns.forEach(c => {
        const id = c.campaign_id || c.id;
        const existing = merged.get(id);
        merged.set(id, existing ? { ...existing, ...c } : c);
      });

      const campaigns = Array.from(merged.values())
        .map(c => ({ ...c, campaign_id: c.campaign_id || c.id }))
        .reverse(); // newest first (assumes id encodes timestamp)

      const hasCampaigns = campaigns.length > 0;

      // Fetch backend events per campaign so the row header step count and
      // the expanded data flow include backend-driven runs (without these,
      // a backend campaign reads as "0 steps" because eventBus.history is
      // only populated when WS is subscribed).
      const eventsById = new Map();
      if (api?.getCampaignEvents) {
        await Promise.all(campaigns.slice(0, 25).map(async (c) => {
          try {
            const resp = await api.getCampaignEvents(c.campaign_id);
            if (resp?.success && Array.isArray(resp.data?.events)) {
              eventsById.set(c.campaign_id, resp.data.events);
            }
          } catch (e) { /* best-effort */ }
        }));
      }

      // Pre-build flows so we know step counts in the header.
      const rows = campaigns.map(c =>
        renderCampaignRow(c, buildCampaignFlow(c, eventBus, eventsById.get(c.campaign_id) || []))
      );

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
            <span></span>
          </header>
          <section class="campaign-list">
            ${rows.join('')}
          </section>
        `}
      `;

      wireRowToggles(outlet);
      wireRowDeletes(outlet, api, paint);
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
