/*
 * Campaign Detail Page — /campaigns/:id
 * Spec: docs/frontend/12-campaigns-page-spec.md
 */

import { i18n }   from '../../i18n/index.js';
import { icon }   from '../icons.js';
import { router } from '../router.js';

function getCtx() { return window.OAG || {}; }
function t(k, d)  { return i18n.t(k) || d; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let cleanup = null;

export default {
  titleKey: 'page_campaign_detail_title',

  async mount(outlet, { params }) {
    const cid = params?.id;
    if (!cid) {
      router.navigate('/campaigns');
      return;
    }

    async function paint() {
      const ctx = getCtx();
      const orchestrator = ctx.orchestrator;
      const api = ctx.api;

      let campaign = orchestrator?.campaigns?.get(cid);

      if (!campaign) {
        try {
          const resp = await api?.getCampaign?.(cid);
          if (resp?.success) {
            campaign = resp.data;
          }
        } catch (e) {}
      }

      if (!campaign) {
        outlet.innerHTML = `
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="#/">${t('nav_hub', 'Hub')}</a>
            ${icon('chevron-right', 'sm')}
            <a href="#/campaigns">${t('nav_campaigns', 'Campaigns')}</a>
          </nav>
          <div class="dag-empty">
            <p>Campaign not found: ${escapeHtml(cid)}</p>
            <button class="btn btn-secondary mt-3" onclick="location.hash='#/campaigns'">Back to list</button>
          </div>
        `;
        return;
      }

      outlet.innerHTML = `
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="#/">${t('nav_hub', 'Hub')}</a>
          ${icon('chevron-right', 'sm')}
          <a href="#/campaigns">${t('nav_campaigns', 'Campaigns')}</a>
          ${icon('chevron-right', 'sm')}
          <span class="breadcrumb-current">${escapeHtml(cid)}</span>
        </nav>

        <header class="section-header" style="display: flex; align-items: center; gap: var(--sp-3);">
          <h1 tabindex="-1" style="margin: 0;">${escapeHtml(campaign.name || cid)}</h1>
          <span class="cred-status-sandbox" style="font-size: var(--fs-xs);">${escapeHtml(campaign.status)}</span>
        </header>

        <div class="metric-row" style="margin-bottom: var(--sp-6);">
          <div class="metric-box">
            <span class="metric-label">Status</span>
            <span class="metric-value">${escapeHtml(campaign.status)}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Budget</span>
            <span class="metric-value">${campaign.budget?.currency || ''} ${campaign.budget?.total || '—'}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">KPI Target</span>
            <span class="metric-value">${escapeHtml(campaign.kpi?.metric || '—')} ${campaign.kpi?.target || ''}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">${t('orch_col_loops', 'Loops')}</span>
            <span class="metric-value">${campaign.loop_count || 0}</span>
          </div>
        </div>

        <section class="activity-section">
          <h3>Active Tasks</h3>
          ${!campaign.active_tasks || campaign.active_tasks.length === 0 ? `
            <p class="muted" style="font-size: var(--fs-sm);">No active tasks.</p>
          ` : `
            <div class="fsm-nodes" style="justify-content: flex-start; gap: var(--sp-2);">
              ${campaign.active_tasks.map(taskId => `
                <div class="fsm-node active"><div class="fsm-node-box">${escapeHtml(taskId)}</div></div>
              `).join('')}
            </div>
          `}
        </section>

        <section class="activity-section" style="margin-top: var(--sp-6);">
          <h3>Agent Execution History (Data Flow)</h3>
          <p class="muted" style="margin-bottom: var(--sp-4); font-size: var(--fs-sm);">
            Detailed trace of what instructions were received, what was executed, and the outputs delivered by each agent.
          </p>
          
          ${!campaign.trace || campaign.trace.length === 0 ? `
            <div class="dag-empty"><p>No execution trace available yet.</p></div>
          ` : `
            <div class="logs-view" style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: var(--sp-3); max-height: 600px; overflow-y: auto;">
              ${campaign.trace.map((tr, i) => `
                <div class="trace-entry" style="margin-bottom: var(--sp-4); padding-bottom: var(--sp-4); border-bottom: ${i < campaign.trace.length - 1 ? '1px dashed var(--border-subtle)' : 'none'};">
                  <div style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2);">
                    <span class="cred-status-sandbox" style="font-weight: bold;">${escapeHtml(tr.agentType)}</span>
                    <span class="muted" style="font-size: var(--fs-xs);">Task: ${escapeHtml(tr.taskId)}</span>
                    <span class="muted" style="font-size: var(--fs-xs); margin-left: auto;">${new Date(tr.timestamp).toLocaleTimeString()}</span>
                  </div>
                  
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4);">
                    <div class="trace-io">
                      <div class="muted" style="font-size: var(--fs-xs); margin-bottom: 4px; text-transform: uppercase;">Input / Received</div>
                      <pre style="background: var(--bg-L2); padding: 8px; border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto; margin: 0; max-height: 200px;">${escapeHtml(JSON.stringify(tr.input, null, 2))}</pre>
                    </div>
                    <div class="trace-io">
                      <div class="muted" style="font-size: var(--fs-xs); margin-bottom: 4px; text-transform: uppercase;">Output / Result</div>
                      ${tr.error 
                        ? `<pre style="background: #fee2e2; color: #b91c1c; padding: 8px; border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto; margin: 0; max-height: 200px;">Error: ${escapeHtml(tr.error)}</pre>`
                        : `<pre style="background: var(--bg-L2); padding: 8px; border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto; margin: 0; max-height: 200px;">${escapeHtml(JSON.stringify(tr.output, null, 2))}</pre>`
                      }
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </section>
      `;
    }

    await paint();

    const ctx = getCtx();
    if (ctx.eventBus) {
      cleanup = ctx.eventBus.subscribe('*', (payload) => {
        if (payload?.campaign_id === cid) {
          paint();
        }
      });
    }
  },

  unmount() {
    if (cleanup) {
      try { cleanup(); } catch {}
      cleanup = null;
    }
  },
};
