/*
 * Governance Inbox — approval queue for the human-in-the-loop gate.
 *
 * Backend pauses campaigns at `PAUSED_FOR_APPROVAL` when one of the
 * governance rules (LEGAL / FINANCE / etc.) fires before a stage. Cases
 * land in `revision_cases`; each tenant role gets one or more `revision_tasks`
 * they need to APPROVE / REJECT. Closing the case re-enqueues the pipeline.
 *
 * This page is a list+detail view onto that queue:
 *   left pane  — OPEN tasks for the caller's roles (poll every ~5s)
 *   right pane — selected case: trigger context + per-role decisions
 *
 * No localStorage cache: backend is authoritative. Auth bearer token is
 * attached automatically by `api._request`.
 */

import { i18n }   from '../../i18n/index.js';
import { icon }   from '../icons.js';
import { router } from '../router.js';
import { statusBadgeClass } from '../campaign-context.js';

function t(k, d) { return i18n.t(k) || d; }
function getCtx() { return window.OAG || {}; }
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

let outletRef = null;
let pollTimer = null;
let cachedTasks = [];
let selectedTaskId = null;
let selectedCase = null;
let caseLoading = false;
let pendingFeedback = '';

// ── Data layer ──────────────────────────────────────────────────────

async function loadInbox() {
  const api = getCtx().api;
  if (!api?.listGovernanceInbox) return [];
  const resp = await api.listGovernanceInbox({ status: 'OPEN' });
  if (resp?.success && Array.isArray(resp.data)) return resp.data;
  return [];
}

async function loadCase(caseId) {
  const api = getCtx().api;
  if (!api?.getGovernanceCase) return null;
  const resp = await api.getGovernanceCase(caseId);
  return resp?.success ? resp.data : null;
}

async function decideTask(taskId, decision, feedback) {
  const api = getCtx().api;
  return api.decideGovernanceTask(taskId, { decision, feedback });
}

// ── Render ──────────────────────────────────────────────────────────

function renderShell() {
  if (!outletRef) return;
  outletRef.innerHTML = `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="#/">${escapeHtml(t('nav_hub', 'Hub'))}</a>
      ${icon('chevron-right', 'sm')}
      <span class="breadcrumb-current">${escapeHtml(t('gov_inbox_title', 'Approval Inbox'))}</span>
    </nav>

    <header class="agent-header" style="--agent-color: var(--warning);">
      <div class="agent-header-id">
        <span class="agent-header-icon">${icon('shield-check', 'lg')}</span>
        <div class="agent-header-text">
          <h1 tabindex="-1">${escapeHtml(t('gov_inbox_title', 'Approval Inbox'))}</h1>
          <p>${escapeHtml(t('gov_inbox_subtitle', 'Campaigns paused at the human-in-the-loop gate. Approve or reject so the pipeline resumes.'))}</p>
        </div>
      </div>
    </header>

    <section class="governance-layout">
      <aside class="governance-list" data-gov-list>
        <div class="muted tiny" style="padding: 12px;">${escapeHtml(t('gov_loading', 'Loading…'))}</div>
      </aside>
      <section class="governance-detail" data-gov-detail>
        <div class="muted" style="padding: 24px; text-align: center;">
          ${escapeHtml(t('gov_select_hint', 'Select a task on the left to review the case.'))}
        </div>
      </section>
    </section>
  `;
}

function renderList() {
  const list = outletRef?.querySelector('[data-gov-list]');
  if (!list) return;
  if (!cachedTasks.length) {
    list.innerHTML = `
      <div class="governance-empty">
        <div class="muted tiny" style="text-align: center; padding: 32px 16px;">
          ${escapeHtml(t('gov_empty', 'No open approvals. Pipelines run without pausing until a governance rule fires.'))}
        </div>
      </div>`;
    return;
  }
  list.innerHTML = cachedTasks.map(task => {
    const cls = task.id === selectedTaskId ? 'active' : '';
    const lvl = Number(task.escalation_level || 0);
    // Color the due cell red if overdue, yellow if < 1h, otherwise neutral —
    // gives the inbox an at-a-glance triage signal once Phase 3 SLA kicks in.
    let dueColor = 'inherit', dueLabel = task.due_at ? fmtTime(task.due_at) : '—';
    if (task.due_at) {
      const dueMs = new Date(task.due_at).getTime() - Date.now();
      if (dueMs < 0)              dueColor = 'var(--danger)';
      else if (dueMs < 3600_000)  dueColor = 'var(--warning)';
    }
    const levelBadge = lvl > 0
      ? `<span class="status-badge danger" title="Escalated ${lvl}× by SLA scanner">L${lvl}</span>`
      : '';
    return `
      <button class="governance-list-item ${cls}" data-task-id="${escapeHtml(task.id)}" data-case-id="${escapeHtml(task.case_id)}">
        <div class="governance-list-item-row">
          <span class="status-badge active">${escapeHtml(task.role)}</span>
          ${levelBadge}
          <span class="governance-list-item-title">${escapeHtml(task.rule_name || task.rule_code)}</span>
        </div>
        <div class="governance-list-item-row tiny muted">
          <span>${escapeHtml(t('gov_stage', 'stage'))}: <code class="code-inline">${escapeHtml(task.stage || '—')}</code></span>
          <span style="color:${dueColor};">${escapeHtml(t('gov_due', 'due'))}: ${escapeHtml(dueLabel)}</span>
        </div>
        <div class="tiny muted">
          ${escapeHtml(t('gov_campaign', 'campaign'))}:
          <code class="code-inline">${escapeHtml((task.campaign_id || '').slice(0, 8))}</code>
        </div>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.governance-list-item').forEach(item => {
    item.addEventListener('click', async () => {
      const taskId = item.dataset.taskId;
      const caseId = item.dataset.caseId;
      selectedTaskId = taskId;
      pendingFeedback = '';
      renderList();
      caseLoading = true;
      renderDetail();
      selectedCase = await loadCase(caseId);
      caseLoading = false;
      renderDetail();
    });
  });
}

function renderDetail() {
  const pane = outletRef?.querySelector('[data-gov-detail]');
  if (!pane) return;

  if (caseLoading) {
    pane.innerHTML = `<div class="muted" style="padding: 24px; text-align: center;"><span class="dot pulse"></span> ${escapeHtml(t('gov_loading', 'Loading…'))}</div>`;
    return;
  }

  if (!selectedCase) {
    pane.innerHTML = `
      <div class="muted" style="padding: 24px; text-align: center;">
        ${escapeHtml(t('gov_select_hint', 'Select a task on the left to review the case.'))}
      </div>`;
    return;
  }

  const c = selectedCase;
  const sortedTasks = (c.tasks || []).slice().sort((a, b) => {
    // OPEN first, then by role
    if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
    if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
    return String(a.role).localeCompare(String(b.role));
  });
  const ctxJson = c.trigger_context ? JSON.stringify(c.trigger_context, null, 2) : '—';

  pane.innerHTML = `
    <div class="governance-detail-head">
      <div>
        <h3>${escapeHtml(t('gov_case_title', 'Case'))} <code class="code-inline">${escapeHtml(c.id.slice(0, 8))}</code></h3>
        <div class="tiny muted">
          ${escapeHtml(t('gov_stage', 'stage'))}: <code class="code-inline">${escapeHtml(c.stage)}</code> ·
          ${escapeHtml(t('gov_campaign', 'campaign'))}: <a href="#/agents/orchestrator?cid=${encodeURIComponent(c.campaign_id)}">
            <code class="code-inline">${escapeHtml(c.campaign_id.slice(0, 8))}</code>
          </a>
        </div>
        <div class="tiny muted">${escapeHtml(t('gov_opened', 'opened'))}: ${escapeHtml(fmtTime(c.opened_at))}</div>
      </div>
      <span class="status-badge ${c.status === 'RESOLVED' ? 'success' : 'warning'}">${escapeHtml(c.status)}</span>
    </div>

    <details class="governance-context" open>
      <summary>${escapeHtml(t('gov_trigger_context', 'Trigger context'))}</summary>
      <pre class="code-block">${escapeHtml(ctxJson)}</pre>
    </details>

    <div class="governance-tasks">
      ${sortedTasks.map(task => renderTaskBlock(task)).join('')}
    </div>
  `;

  // Bind decide buttons + feedback input
  pane.querySelectorAll('[data-decide]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      const decision = btn.dataset.decide;
      const feedbackEl = pane.querySelector(`[data-feedback="${CSS.escape(taskId)}"]`);
      const feedback = feedbackEl?.value || null;
      btn.disabled = true;
      btn.classList.add('loading');
      const resp = await decideTask(taskId, decision, feedback);
      btn.classList.remove('loading');
      btn.disabled = false;
      if (resp?.success) {
        // Reload the case and inbox so the user sees the new state immediately.
        const caseId = selectedCase.id;
        selectedCase = await loadCase(caseId);
        cachedTasks = await loadInbox();
        renderList();
        renderDetail();
      } else {
        const msg = resp?.error || 'Decision failed';
        const errEl = pane.querySelector('[data-decision-error]');
        if (errEl) {
          errEl.textContent = `${decision}: ${msg}`;
          errEl.style.display = 'block';
        } else {
          alert(msg);
        }
      }
    });
  });
}

function renderTaskBlock(task) {
  const isOpen = task.status === 'OPEN';
  const decidedSummary = !isOpen
    ? `<div class="tiny muted">${escapeHtml(t('gov_decided_at', 'decided'))}: ${escapeHtml(fmtTime(task.decided_at))}</div>`
    : '';
  const feedbackBlock = task.feedback
    ? `<div class="governance-task-feedback">${escapeHtml(task.feedback)}</div>`
    : '';
  const inputBlock = isOpen ? `
    <textarea class="modal-textarea" rows="2"
              data-feedback="${escapeHtml(task.id)}"
              placeholder="${escapeHtml(t('gov_feedback_ph', 'Optional feedback (visible to the campaign owner)…'))}"></textarea>
    <div class="governance-task-actions">
      <button class="btn btn-secondary" data-decide="REJECT" data-task-id="${escapeHtml(task.id)}">
        ${icon('x', 'sm')} ${escapeHtml(t('gov_btn_reject', 'Reject'))}
      </button>
      <button class="btn btn-primary" data-decide="APPROVE" data-task-id="${escapeHtml(task.id)}">
        ${icon('check', 'sm')} ${escapeHtml(t('gov_btn_approve', 'Approve'))}
      </button>
    </div>
    <p class="tiny muted" data-decision-error style="color: var(--danger); display: none;"></p>
  ` : '';

  const statusCls = task.status === 'APPROVED' ? 'success'
                 : task.status === 'REJECTED' ? 'danger'
                 : 'warning';

  return `
    <article class="governance-task ${isOpen ? 'open' : 'decided'}">
      <header class="governance-task-head">
        <span class="status-badge active">${escapeHtml(task.role)}</span>
        <span class="governance-task-title">${escapeHtml(task.rule_name || task.rule_code)}</span>
        <span class="status-badge ${statusCls}">${escapeHtml(task.status)}</span>
      </header>
      ${decidedSummary}
      ${feedbackBlock}
      ${inputBlock}
    </article>
  `;
}

// ── Polling loop ────────────────────────────────────────────────────

async function refresh() {
  cachedTasks = await loadInbox();
  renderList();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refresh, 5000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ── Page module ─────────────────────────────────────────────────────

export default {
  titleKey: 'gov_inbox_title',
  async mount(outlet) {
    outletRef = outlet;
    renderShell();
    await refresh();
    startPolling();
  },
  unmount() {
    stopPolling();
    outletRef = null;
    cachedTasks = [];
    selectedTaskId = null;
    selectedCase = null;
    caseLoading = false;
  },
};
