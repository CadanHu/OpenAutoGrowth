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
  const name = (campaign.name || campaign.goal || cid || '').toString();
  const nameTrunc = name.length > 60 ? name.slice(0, 59) + '…' : name;
  return `
    <div class="agent-cid-banner">
      <span class="tiny muted">${t('agent_cid_banner_label', 'Viewing campaign')}</span>
      <span class="agent-cid-banner-name" title="${escapeHtmlAttr(name)}">${escapeHtmlAttr(nameTrunc)}</span>
      <code class="code-inline tiny">${(cid || '').slice(0, 8)}</code>
      <span class="status-badge ${cls}">${escapeHtmlAttr(campaign.status || '—')}</span>
      <span class="tiny muted">${escapeHtmlAttr(stampStr)}</span>
      <span class="tiny muted agent-cid-banner-hint">
        ${t('agent_cid_banner_switch', 'Switch via the chip in the top nav.')}
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
  if (status === 'PAUSED') return 'warning';
  if (status === 'COMPLETED') return 'success';
  if (status === 'DRAFT') return 'muted';
  if (status.endsWith('_FAILED') || status === 'FAILED') return 'danger';
  return 'active';
}
