/*
 * Campaign Context — global "currently viewing" campaign state.
 *
 * Source of truth: URL hash query `?cid=<uuid>`. localStorage is a fallback
 * for cold start. All consumers (top-nav selector, agent pages, orchestrator
 * tabs) read/write through here, so the URL stays canonical and copying a
 * link gives the recipient the same context.
 *
 * Pages call `subscribeCampaignChange(cb)` and repaint themselves when the
 * cid changes — no full router re-resolve happens (we use replaceState).
 */

import { router } from './router.js';

const LS_LAST_CID = 'oag_active_cid';
const subscribers = new Set();
let lastCid = readCidFromUrl();

function readCidFromUrl() {
  return router.getQuery().cid || null;
}

// `queryChanged` is dispatched by router.setQuery. Filter to cid changes only
// — pages don't want a repaint when only `tab` or `intent` flipped.
document.addEventListener('queryChanged', () => {
  const cid = readCidFromUrl();
  if (cid !== lastCid) {
    lastCid = cid;
    if (cid) {
      try { localStorage.setItem(LS_LAST_CID, cid); } catch {}
    }
    subscribers.forEach(cb => { try { cb(cid); } catch (e) { console.error('[campaign-context] subscriber threw', e); } });
  }
});
// Also catch external nav (browser back, hand-edited URL) — those fire
// `routeChanged` (router._resolve) but not queryChanged. Re-derive cid.
document.addEventListener('routeChanged', () => {
  const cid = readCidFromUrl();
  if (cid !== lastCid) {
    lastCid = cid;
    subscribers.forEach(cb => { try { cb(cid); } catch (e) { console.error(e); } });
  }
});

export function getActiveCid() {
  return readCidFromUrl();
}

export function setActiveCid(id) {
  router.setQuery({ cid: id || null });
  if (id) {
    try { localStorage.setItem(LS_LAST_CID, id); } catch {}
  }
  // Note: setQuery dispatches queryChanged → our listener above fires
  // subscribers. No need to call them again here.
}

// Pick a sensible default cid if the URL doesn't have one.
//   1. localStorage's last-seen, if still valid
//   2. caller's `preferred` predicate (e.g. "first non-PAUSED")
//   3. campaigns[0]
// Returns null if `campaigns` is empty.
export function resolveDefaultCid(campaigns, preferred) {
  if (!campaigns?.length) return null;
  const valid = new Set(campaigns.map(c => c.campaign_id || c.id));
  let stored = null;
  try { stored = localStorage.getItem(LS_LAST_CID); } catch {}
  if (stored && valid.has(stored)) return stored;
  if (preferred) {
    const hit = campaigns.find(preferred);
    if (hit) return hit.campaign_id || hit.id;
  }
  const first = campaigns[0];
  return first.campaign_id || first.id;
}

// Subscribe to cid changes. Returns an unsubscribe function.
export function subscribeCampaignChange(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// Render a small "currently viewing" banner at the top of an agent page.
// Returns HTML string. The banner is informational + a hint to switch via
// the top-nav chip; clicking it opens that menu.
//
// `i18nT` is passed in so the caller's i18n context is used (prevents a
// circular import on i18n module from this generic helper).
// The hub modal stuffs all campaign metadata into the backend `goal` field
// as `[Type: X] Objective: Y. Desc: Z. URL: W. Region: V.` for the LLM
// prompt. That string is great for the planner but ugly in UI chrome —
// extract just the human-written Desc when we have one. Falls back to the
// campaign name, then a trimmed goal, then the id.
export function prettyCampaignName(campaign, cid) {
  if (!campaign) return cid || '';
  // hub's launch modal serializes form fields into the backend `goal` as
  // `[Type: X] Objective: Y. Desc: Z. URL: W. Region: V.`, and the backend
  // copies goal[:60] into `name` when no name is supplied — so both fields
  // can carry that prompt-format prefix. Strip it whenever we see it.
  const stripPromptPrefix = (s) => {
    if (!s) return '';
    const m = String(s).match(/Desc:\s*([^]*?)(?:\.\s*URL:|\.\s*Region:|$)/i);
    if (m && m[1].trim()) return m[1].trim();
    return String(s).replace(/^\[Type:[^\]]*\]\s*(Objective:[^.]*\.\s*)?/i, '').trim();
  };
  const fromName = stripPromptPrefix(campaign.name);
  if (fromName) return fromName;
  const fromGoal = stripPromptPrefix(campaign.goal);
  if (fromGoal) return fromGoal;
  return cid || '';
}

// Friendly short labels for the long backend status enum. Keeps the
// banner's right-hand badge from dominating the row. Falls back to the
// raw status if not mapped.
const STATUS_LABELS = {
  zh: {
    DRAFT: '草稿', PLANNING: '规划中', PLANNING_FAILED: '规划失败',
    PENDING_REVIEW: '待审核', PAUSED_FOR_APPROVAL: '待审核',
    PRODUCTION: '生产中', PRODUCTION_FAILED: '生产失败',
    DEPLOYED: '已投放', MONITORING: '监控中', OPTIMIZING: '优化中',
    LOOP_1: '优化中', LOOP_2: '优化中', LOOP_3: '优化中', LOOP_4: '优化中', LOOP_5: '优化中',
    PAUSED: '已暂停', FAILED: '失败', COMPLETED: '已完成',
  },
  en: {
    DRAFT: 'Draft', PLANNING: 'Planning', PLANNING_FAILED: 'Plan Failed',
    PENDING_REVIEW: 'In Review', PAUSED_FOR_APPROVAL: 'Awaiting Review',
    PRODUCTION: 'Producing', PRODUCTION_FAILED: 'Build Failed',
    DEPLOYED: 'Deployed', MONITORING: 'Monitoring', OPTIMIZING: 'Optimizing',
    LOOP_1: 'Loop 1', LOOP_2: 'Loop 2', LOOP_3: 'Loop 3', LOOP_4: 'Loop 4', LOOP_5: 'Loop 5',
    PAUSED: 'Paused', FAILED: 'Failed', COMPLETED: 'Completed',
  },
};

export function shortStatusLabel(status) {
  if (!status) return '—';
  let locale = 'zh';
  try { locale = (localStorage.getItem('locale') || 'zh') === 'en' ? 'en' : 'zh'; } catch {}
  return STATUS_LABELS[locale][status] || status;
}

export function renderCampaignBanner({ campaign, i18nT }) {
  const t = i18nT || ((k, d) => d);
  if (!campaign) {
    return `
      <div class="agent-cid-banner empty">
        <span class="muted tiny">${t('agent_cid_banner_none', 'No campaign selected — pick one from the top-nav chip to scope this page.')}</span>
      </div>`;
  }
  const cid = campaign.id || campaign.campaign_id;
  const cls = statusBadgeClass(campaign.status);
  const stamp = campaign.updated_at || campaign.created_at;
  const stampStr = stamp ? new Date(stamp).toLocaleString([], {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '—';
  const name = prettyCampaignName(campaign, cid);
  const nameTrunc = name.length > 60 ? name.slice(0, 59) + '…' : name;
  return `
    <div class="agent-cid-banner">
      <div class="agent-cid-banner-primary">
        <span class="tiny muted agent-cid-banner-eyebrow">${t('agent_cid_banner_label', 'Viewing campaign')}</span>
        <span class="agent-cid-banner-name" title="${escapeHtmlAttr(name)}">${escapeHtmlAttr(nameTrunc)}</span>
      </div>
      <div class="agent-cid-banner-meta">
        <code class="code-inline tiny">${(cid || '').slice(0, 8)}</code>
        <span class="status-badge ${cls}" title="${escapeHtmlAttr(campaign.status || '')}">${escapeHtmlAttr(shortStatusLabel(campaign.status))}</span>
        <span class="tiny muted agent-cid-banner-stamp">${escapeHtmlAttr(stampStr)}</span>
      </div>
      <span class="tiny muted agent-cid-banner-hint">
        ${t('agent_cid_banner_switch', 'Switch via the chip in the top nav.')}
      </span>
    </div>`;
}

// Render a clearly-marked "this section shows demo data" banner.
// Use on agent tabs where the displayed numbers / state come from a
// frontend-only simulator (Math.random, in-browser memory, hard-coded
// rules) instead of the real backend pipeline. Without this banner
// users mistake mocks for production output.
//
//   kind       — short label for what's mocked ("Mock LLM output", etc.)
//   what       — one sentence: which data is fake
//   why        — optional: what the real source will be / when it lands
//   severity   — 'info' (default, yellow) | 'warn' (orange, stronger)
//   i18nT      — caller's t(key, fallback) function
export function renderMockBanner({ kind, what, why, severity = 'info', i18nT }) {
  const t = i18nT || ((k, d) => d);
  const label = kind || t('mock_banner_label', 'Demo data');
  const cls = severity === 'warn' ? 'warn' : '';
  return `
    <div class="mock-data-banner ${cls}" role="note">
      <span class="mock-data-banner-tag">${escapeHtmlAttr(label)}</span>
      <span class="mock-data-banner-text">
        ${escapeHtmlAttr(what || '')}
        ${why ? `<span class="muted tiny" style="margin-left: 6px;">${escapeHtmlAttr(why)}</span>` : ''}
      </span>
    </div>`;
}

function escapeHtmlAttr(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Tone class for status badges — exported so the top-nav chip and per-page
// banners stay visually consistent.
export function statusBadgeClass(status) {
  if (!status) return 'muted';
  if (status === 'PAUSED' || status === 'PAUSED_FOR_APPROVAL') return 'warning';
  if (status === 'COMPLETED') return 'success';
  if (status === 'DRAFT') return 'muted';
  if (status.endsWith('_FAILED') || status === 'FAILED') return 'danger';
  return 'active';
}
