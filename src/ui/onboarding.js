/*
 * Onboarding tour engine.
 *
 * State machine + spotlight overlay + tooltip card. Steps are declared in
 * the `STEPS` array below; each step is data: target selector, copy keys,
 * optional onEnter() side-effect (navigate, click, fill form, ...).
 *
 * Persistence: localStorage flag `oag_tour_state` records 'completed' /
 * 'skipped'. Cross-device sync via a backend column is wired into the
 * `_persistBackend()` hook — currently a no-op stub since the project
 * doesn't have a user table yet (see TODO).
 *
 * Triggered automatically on app boot via `maybeAutoStart()`. Can be
 * replayed from the Hub footer's "Replay tour" link.
 */

import { i18n } from '../i18n/index.js';
import { router } from './router.js';

const LS_KEY = 'oag_tour_state';

function t(key, fallback) { return i18n.t(key) || fallback; }

// ── Step definitions ───────────────────────────────────────────────
// Each step:
//   id        — stable identifier (for logging / mid-tour resume)
//   mode      — 'modal' (centered card, no spotlight) | 'spotlight' (highlight a target)
//   target    — () => HTMLElement | null  (only when mode='spotlight')
//   title     — i18n key
//   body      — i18n key
//   placement — 'top'|'right'|'bottom'|'left'|'auto' (spotlight only)
//   cta       — i18n key for primary button label
//   auto      — true means advance after onEnter resolves (no user click)
//   beforeShow— async () => void  — run BEFORE rendering the step (navigate, wait DOM, …)
//   onAdvance — async () => void  — run when user clicks Next, BEFORE next step's beforeShow
//
// All copy lives in i18n keys with the `tour_` prefix.
const STEPS = [
  {
    id: 'welcome',
    mode: 'modal',
    title: 'tour_welcome_title',
    body:  'tour_welcome_body',
    cta:   'tour_btn_start',
    secondaryCta: 'tour_btn_skip',
  },
  {
    id: 'hub_launch',
    mode: 'spotlight',
    target: () => document.getElementById('btn-launch'),
    placement: 'bottom',
    beforeShow: async () => {
      if (router.current_path() !== '/') router.navigate('/');
      await waitForElement('#btn-launch', 4000);
    },
    title: 'tour_hub_launch_title',
    body:  'tour_hub_launch_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'launch_modal',
    mode: 'spotlight',
    target: () => document.querySelector('#launch-modal .modal-content') || document.getElementById('launch-modal'),
    placement: 'left',
    beforeShow: async () => {
      // Open the Launch modal if not already visible.
      const modal = document.getElementById('launch-modal');
      if (!modal || getComputedStyle(modal).display === 'none') {
        document.getElementById('btn-launch')?.click();
      }
      await waitForElement('#launch-modal', 3000);
      // Wait one extra frame so the modal is on-screen before measuring it.
      await new Promise(r => requestAnimationFrame(r));
      _fillSampleCampaign();
    },
    title: 'tour_launch_modal_title',
    body:  'tour_launch_modal_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'submit_campaign',
    mode: 'modal',
    auto: true,
    beforeShow: async () => {
      // Submit the form — Hub's flow calls createCampaign + startCampaign.
      document.getElementById('btn-confirm-launch')?.click();
      // Wait for the orchestrator's campaigns Map to gain a new entry.
      await waitForCampaign(10000);
    },
    title: 'tour_submit_title',
    body:  'tour_submit_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'top_nav_chip',
    mode: 'spotlight',
    target: () => document.getElementById('campaign-chip'),
    placement: 'bottom',
    beforeShow: async () => { await waitForElement('#campaign-chip', 3000); },
    title: 'tour_chip_title',
    body:  'tour_chip_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'orchestrator_fsm',
    mode: 'spotlight',
    target: () => document.querySelector('.fsm-nodes') || document.querySelector('.fsm-canvas'),
    placement: 'top',
    beforeShow: async () => {
      router.navigate('/agents/orchestrator', { tab: 'fsm' });
      await waitForElement('.fsm-nodes, .fsm-canvas', 5000);
    },
    title: 'tour_fsm_title',
    body:  'tour_fsm_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'pipeline_buckets',
    mode: 'spotlight',
    target: () => document.querySelector('.panel-card-body'),
    placement: 'bottom',
    beforeShow: async () => {
      router.navigate('/agents/orchestrator', { tab: 'overview' });
      await waitForElement('.panel-card-body', 3000);
    },
    title: 'tour_buckets_title',
    body:  'tour_buckets_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'planner',
    mode: 'spotlight',
    target: () => document.querySelector('.agent-cid-banner') || document.querySelector('.metric-row'),
    placement: 'bottom',
    beforeShow: async () => {
      router.navigate('/agents/planner');
      await waitForElement('.agent-cid-banner, .metric-row', 4000);
    },
    title: 'tour_planner_title',
    body:  'tour_planner_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'planner_tabs',
    mode: 'spotlight',
    target: () => document.querySelector('.agent-tabs'),
    placement: 'bottom',
    beforeShow: async () => { await waitForElement('.agent-tabs', 3000); },
    title: 'tour_tabs_planner_title',
    body:  'tour_tabs_planner_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'strategy',
    mode: 'spotlight',
    target: () => document.querySelector('.metric-row'),
    placement: 'bottom',
    beforeShow: async () => {
      router.navigate('/agents/strategy');
      await waitForElement('.metric-row', 4000);
    },
    title: 'tour_strategy_title',
    body:  'tour_strategy_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'strategy_tabs',
    mode: 'spotlight',
    target: () => document.querySelector('.agent-tabs'),
    placement: 'bottom',
    beforeShow: async () => { await waitForElement('.agent-tabs', 3000); },
    title: 'tour_tabs_strategy_title',
    body:  'tour_tabs_strategy_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'creative',
    mode: 'spotlight',
    target: () => document.querySelector('.metric-row'),
    placement: 'bottom',
    beforeShow: async () => {
      router.navigate('/agents/content-gen');
      await waitForElement('.metric-row', 4000);
    },
    title: 'tour_creative_title',
    body:  'tour_creative_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'creative_tabs',
    mode: 'spotlight',
    target: () => document.querySelector('.agent-tabs'),
    placement: 'bottom',
    beforeShow: async () => { await waitForElement('.agent-tabs', 3000); },
    title: 'tour_tabs_creative_title',
    body:  'tour_tabs_creative_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'channel_exec',
    mode: 'spotlight',
    target: () => document.querySelector('.metric-row'),
    placement: 'bottom',
    beforeShow: async () => {
      router.navigate('/agents/channel-exec');
      await waitForElement('.metric-row', 4000);
    },
    title: 'tour_channel_title',
    body:  'tour_channel_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'channel_exec_tabs',
    mode: 'spotlight',
    target: () => document.querySelector('.agent-tabs'),
    placement: 'bottom',
    beforeShow: async () => { await waitForElement('.agent-tabs', 3000); },
    title: 'tour_tabs_channel_title',
    body:  'tour_tabs_channel_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'analysis',
    mode: 'spotlight',
    target: () => document.querySelector('.metric-row'),
    placement: 'bottom',
    beforeShow: async () => {
      router.navigate('/agents/analysis');
      await waitForElement('.metric-row', 4000);
    },
    title: 'tour_analysis_title',
    body:  'tour_analysis_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'analysis_tabs',
    mode: 'spotlight',
    target: () => document.querySelector('.agent-tabs'),
    placement: 'bottom',
    beforeShow: async () => { await waitForElement('.agent-tabs', 3000); },
    title: 'tour_tabs_analysis_title',
    body:  'tour_tabs_analysis_body',
    cta:   'tour_btn_next',
  },
  {
    id: 'done',
    mode: 'modal',
    title: 'tour_done_title',
    body:  'tour_done_body',
    cta:   'tour_btn_finish',
  },
];

// ── State + DOM ────────────────────────────────────────────────────

let _state = { active: false, idx: 0, overlay: null, card: null };
let _newCampaignId = null;     // captured when the sample campaign is created

function _readPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _writePersisted(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...state, at: new Date().toISOString() }));
  } catch {}
  _persistBackend(state).catch(() => {}); // fire-and-forget
}

// TODO(backend): wire this to `POST /v1/user/tour-state` once the project
// gets a real user table. For now it's a stub so the call surface exists
// and callers don't need to change later.
async function _persistBackend(state) {
  // const api = window.OAG?.api;
  // if (!api?.setTourState) return;
  // try { await api.setTourState(state); } catch {}
}

// ── Public API ─────────────────────────────────────────────────────

export function maybeAutoStart() {
  if (_state.active) return;
  const persisted = _readPersisted();
  if (persisted?.status === 'completed' || persisted?.status === 'skipped') return;
  // Defer to next tick to make sure the shell + outlet are mounted.
  setTimeout(() => start(), 400);
}

export function start() {
  if (_state.active) return;
  _state.active = true;
  _state.idx = 0;
  _mountOverlay();
  _renderCurrent();
}

export function skip() {
  _writePersisted({ status: 'skipped' });
  _teardown();
}

export function reset() {
  try { localStorage.removeItem(LS_KEY); } catch {}
  start();
}

// ── Rendering ──────────────────────────────────────────────────────

function _mountOverlay() {
  if (_state.overlay) return;
  const o = document.createElement('div');
  o.className = 'tour-overlay';
  o.innerHTML = `
    <div class="tour-backdrop" data-tour-backdrop></div>
    <div class="tour-spotlight" data-tour-spotlight></div>
    <div class="tour-card" data-tour-card role="dialog" aria-modal="true"></div>
  `;
  document.body.appendChild(o);
  _state.overlay = o;
  _state.card = o.querySelector('[data-tour-card]');
  o.querySelector('[data-tour-backdrop]')?.addEventListener('click', (e) => {
    // Clicks on the backdrop are absorbed — prevent the user from clicking
    // through to the underlying app and breaking the tour state.
    e.stopPropagation();
  });
  // Esc anywhere = skip
  document.addEventListener('keydown', _onKey);
  window.addEventListener('resize', _reposition);
  window.addEventListener('scroll', _reposition, true);
}

function _onKey(e) {
  if (!_state.active) return;
  if (e.key === 'Escape') skip();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') _advance();
}

function _teardown() {
  document.removeEventListener('keydown', _onKey);
  window.removeEventListener('resize', _reposition);
  window.removeEventListener('scroll', _reposition, true);
  _state.overlay?.remove();
  _state = { active: false, idx: 0, overlay: null, card: null };
  _newCampaignId = null;
}

async function _renderCurrent() {
  const step = STEPS[_state.idx];
  if (!step) { _writePersisted({ status: 'completed' }); _teardown(); return; }

  // Pre-step work (navigation, form-fill, waiting on DOM).
  if (step.beforeShow) {
    _setCardLoading(step);
    try { await step.beforeShow(); }
    catch (e) { console.warn(`[tour] step ${step.id} beforeShow failed`, e); }
  }

  _paintCard(step);
  _paintSpotlight(step);

  // Auto-advance for action steps after a brief pause to show feedback.
  if (step.auto) {
    setTimeout(() => _advance(), 1200);
  }
}

function _setCardLoading(step) {
  if (!_state.card) return;
  _state.card.classList.add('loading');
  _state.card.innerHTML = `
    <div class="tour-card-body">
      <div class="tour-card-loading"><span class="dot pulse"></span>${t('tour_loading', 'Preparing…')}</div>
    </div>
  `;
  // Hide the spotlight while we're loading — otherwise it stays parked on
  // the *previous* step's target, looks like it's highlighting the wrong
  // element on the freshly-navigated page. Position is recomputed in
  // _paintSpotlight() once beforeShow() resolves.
  const spotlight = _state.overlay?.querySelector('[data-tour-spotlight]');
  if (spotlight) spotlight.style.display = 'none';
  // Also center the card while loading so it's not stuck next to the old
  // (now-irrelevant) spotlight position.
  _state.card.classList.add('centered');
  _state.card.style.top = '50%';
  _state.card.style.left = '50%';
  _state.card.style.transform = 'translate(-50%, -50%)';
}

function _paintCard(step) {
  const card = _state.card;
  if (!card) return;
  card.classList.remove('loading');
  const stepNum = _state.idx + 1;
  const total   = STEPS.length;
  const title = t(step.title, step.title);
  const body  = t(step.body, step.body);
  const cta   = t(step.cta || 'tour_btn_next', 'Next');
  const sec   = step.secondaryCta ? t(step.secondaryCta, 'Skip') : null;
  const isModal = step.mode === 'modal';
  card.dataset.mode = step.mode;
  card.innerHTML = `
    <div class="tour-card-head">
      <span class="tour-step-counter">${stepNum} / ${total}</span>
      <button class="tour-skip-btn" type="button" data-tour-skip aria-label="${t('tour_btn_skip', 'Skip tour')}">×</button>
    </div>
    <div class="tour-card-body">
      <h3 class="tour-card-title">${escapeHtml(title)}</h3>
      <p class="tour-card-text">${escapeHtml(body)}</p>
    </div>
    <div class="tour-card-actions">
      ${sec ? `<button class="btn btn-secondary" data-tour-secondary type="button">${escapeHtml(sec)}</button>` : ''}
      ${step.auto ? `<span class="tour-auto-hint tiny muted">${t('tour_auto_hint', 'Auto-advancing…')}</span>`
                  : `<button class="btn btn-primary" data-tour-next type="button">${escapeHtml(cta)}</button>`}
    </div>
  `;
  card.querySelector('[data-tour-skip]')?.addEventListener('click', skip);
  card.querySelector('[data-tour-secondary]')?.addEventListener('click', skip);
  card.querySelector('[data-tour-next]')?.addEventListener('click', _advance);
}

async function _advance() {
  const step = STEPS[_state.idx];
  if (step?.onAdvance) {
    try { await step.onAdvance(); } catch (e) { console.warn('[tour] onAdvance', e); }
  }
  _state.idx += 1;
  _renderCurrent();
}

function _paintSpotlight(step) {
  const spotlight = _state.overlay?.querySelector('[data-tour-spotlight]');
  const card = _state.card;
  if (!spotlight || !card) return;

  if (step.mode === 'modal') {
    spotlight.style.display = 'none';
    card.classList.add('centered');
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    return;
  }

  card.classList.remove('centered');
  const el = step.target?.();
  if (!el) {
    // No target found — center the card as a fallback so the tour doesn't stall.
    spotlight.style.display = 'none';
    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    return;
  }
  const rect = el.getBoundingClientRect();
  const pad = 8;
  spotlight.style.display = 'block';
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  _positionCard(card, rect, step.placement || 'bottom');
}

function _positionCard(card, rect, placement) {
  const margin = 16;
  const cardW = card.offsetWidth || 360;
  const cardH = card.offsetHeight || 220;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Pick fallback placements if the requested one would go off-screen.
  const placements = [placement, 'bottom', 'top', 'right', 'left'];
  let chosen = null;
  for (const p of placements) {
    const pos = _computePos(rect, p, cardW, cardH, margin);
    if (pos.top >= margin && pos.top + cardH <= vh - margin
     && pos.left >= margin && pos.left + cardW <= vw - margin) {
      chosen = { ...pos, placement: p };
      break;
    }
  }
  if (!chosen) chosen = _computePos(rect, 'bottom', cardW, cardH, margin);

  // Final safety: clamp into the viewport so the Next/Skip buttons are
  // always reachable, even when the target rect overlaps a fullscreen modal
  // and no placement actually fits.
  const maxTop  = Math.max(margin, vh - cardH - margin);
  const maxLeft = Math.max(margin, vw - cardW - margin);
  chosen.top  = Math.min(Math.max(chosen.top,  margin), maxTop);
  chosen.left = Math.min(Math.max(chosen.left, margin), maxLeft);

  card.style.top = `${chosen.top}px`;
  card.style.left = `${chosen.left}px`;
  card.style.transform = 'none';
}

function _computePos(rect, placement, cardW, cardH, margin) {
  switch (placement) {
    case 'top':    return { top: rect.top - cardH - margin, left: rect.left + (rect.width - cardW) / 2 };
    case 'bottom': return { top: rect.bottom + margin,       left: rect.left + (rect.width - cardW) / 2 };
    case 'left':   return { top: rect.top + (rect.height - cardH) / 2, left: rect.left - cardW - margin };
    case 'right':  return { top: rect.top + (rect.height - cardH) / 2, left: rect.right + margin };
    default:       return { top: rect.bottom + margin, left: rect.left };
  }
}

function _reposition() {
  if (!_state.active) return;
  const step = STEPS[_state.idx];
  if (step) _paintSpotlight(step);
}

// ── Helpers ────────────────────────────────────────────────────────

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function waitForElement(selector, timeoutMs = 3000) {
  const t0 = Date.now();
  return new Promise(resolve => {
    const tick = () => {
      if (document.querySelector(selector)) return resolve();
      if (Date.now() - t0 > timeoutMs) return resolve();      // soft timeout — proceed anyway
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// Wait until the orchestrator's campaigns Map gains a new entry — that
// signals the createCampaign response came back. Captures the id so the
// rest of the tour can scope to it.
async function waitForCampaign(timeoutMs = 8000) {
  const t0 = Date.now();
  const beforeIds = new Set(Object.keys(_collectCids()));
  return new Promise(resolve => {
    const tick = () => {
      const after = _collectCids();
      const newIds = Object.keys(after).filter(id => !beforeIds.has(id));
      if (newIds.length) {
        _newCampaignId = newIds[0];
        // Also write it into the URL so all agent pages scope to it.
        try {
          import('./campaign-context.js').then(m => m.setActiveCid(newIds[0])).catch(() => {});
        } catch {}
        return resolve();
      }
      if (Date.now() - t0 > timeoutMs) return resolve();      // soft timeout
      setTimeout(tick, 200);
    };
    tick();
  });
}

function _collectCids() {
  const map = window.OAG?.orchestrator?.campaigns;
  if (!map) return {};
  const out = {};
  for (const id of map.keys()) out[id] = true;
  return out;
}

// Pre-fill the launch modal with a sensible sample. Fields are matched by
// id first, then by `[data-launch-*]` attributes if present.
function _fillSampleCampaign() {
  const set = (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('#promo-url-input',      'https://example.com/smart-watch');
  set('#promo-goal-input',     t('tour_sample_desc', 'Sample campaign — smart watch with long battery, target young professionals.'));
  set('#promo-budget-input',   '50000');
  set('#promo-duration-input', '14');
  set('#promo-kpi-input',      '3.0');
  const objective = document.getElementById('promo-objective-select');
  if (objective?.tagName === 'SELECT') {
    objective.value = 'conversion';
    objective.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
