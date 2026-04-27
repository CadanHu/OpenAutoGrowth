/*
 * Multimodal Agent Page — asset library + generation playground.
 * Spec: docs/frontend/10-multimodal-page-spec.md
 *
 * Data sources:
 *   - memory.shortTerm                                → full asset metadata (Library / Overview)
 *   - eventBus.history['AssetsGenerated']             → counts, Runs, Logs
 *   - orchestrator.agents.get('Multimodal').run({...})→ Playground preview
 *
 * Asset URLs are mock CDN paths — we render SVG placeholders, no network.
 */

import { i18n }             from '../../i18n/index.js';
import { icon }             from '../icons.js';
import { router }           from '../router.js';
import { AGENTS }           from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID = 'multimodal';
const KNOWN_RATIOS = ['1:1', '9:16', '16:9', '4:5', '4:3'];
const STYLES = ['minimalist', 'vibrant', 'professional'];
const KNOWN_CHANNELS = ['tiktok', 'meta', 'google', 'wechat'];

// ── Utilities ─────────────────────────────────────────────────────
function getCtx()  { return window.OAG || {}; }
function t(k, d)   { return i18n.t(k) || d; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—'; }
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function assetEvents() {
  return (getCtx().eventBus?.history || []).filter(e => e.event_type === 'AssetsGenerated');
}
function getAgent() { return getCtx().orchestrator?.agents?.get?.('Multimodal') || null; }

/** Iterate Memory shortTerm and pull every Multimodal output's assets. */
function collectAssets() {
  const memory = getCtx().memory;
  const out = [];
  if (!memory?.shortTerm) return out;
  for (const [key, entry] of memory.shortTerm.entries()) {
    const v = entry.value;
    if (v?.agent === 'MULTIMODAL' && Array.isArray(v.assets) && v.assets.length) {
      const cid = key.split(':')[0];
      const generatedAt = v.metadata?.generated_at || new Date(entry.timestamp).toISOString();
      for (const asset of v.assets) {
        out.push({ ...asset, campaign_id: cid, generated_at: generatedAt });
      }
    }
  }
  // Newest first
  return out.sort((a, b) => (b.generated_at || '').localeCompare(a.generated_at || ''));
}

/** SVG placeholder for an asset card (no network). */
function placeholderSvg(ratio, type) {
  const [w, h] = ratio.split(':').map(Number);
  const W = 200;
  const H = Math.round((W * h) / w);
  const isVideo = (type || '').toUpperCase() === 'VIDEO';
  const tone = isVideo ? 'var(--agent-multimodal)' : 'var(--accent-primary)';
  const ico = isVideo
    ? '<polygon points="42,32 42,68 70,50" fill="currentColor"/>'
    : '<rect x="32" y="32" width="36" height="36" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="44" cy="46" r="3" fill="currentColor"/><polyline points="32,68 50,52 68,66" fill="none" stroke="currentColor" stroke-width="2"/>';
  return `
    <svg viewBox="0 0 100 ${(100 * h) / w}" preserveAspectRatio="xMidYMid meet"
         class="asset-thumb-svg" aria-hidden="true"
         style="width:100%; aspect-ratio: ${w}/${h}; background:color-mix(in srgb, ${tone} 8%, var(--bg-L2)); color:${tone};">
      <g transform="translate(${(100 - 100) / 2}, ${((100 * h) / w - 100) / 2})">${ico}</g>
      <text x="50" y="${((100 * h) / w) - 6}" text-anchor="middle"
            font-size="6" fill="currentColor" opacity="0.6"
            font-family="ui-monospace, Menlo, monospace">${ratio}</text>
    </svg>
  `;
  // Note: width/height not used; aspect-ratio CSS is enough.
  void [W, H];
}

function renderAssetCard(asset, opts = {}) {
  const dims = `${asset.width_px || '?'}×${asset.height_px || '?'}`;
  const dur = asset.duration_sec ? ` · ${asset.duration_sec}s` : '';
  return `
    <article class="asset-card" data-asset-id="${escapeHtml(asset.id)}">
      <div class="asset-thumb">${placeholderSvg(asset.aspect_ratio || '1:1', asset.type)}</div>
      <div class="asset-meta">
        <div class="asset-meta-head">
          <span class="asset-pill">${escapeHtml((asset.type || 'IMAGE').toLowerCase())}</span>
          <span class="muted tiny">${escapeHtml(asset.aspect_ratio || '—')}</span>
        </div>
        <div class="muted tiny">${escapeHtml(asset.tool || '—')} · ${dims}${dur}</div>
        ${opts.showCampaign && asset.campaign_id ? `<div class="muted tiny">cid ${escapeHtml(asset.campaign_id.slice(0, 10))}…</div>` : ''}
      </div>
      ${opts.expandable ? `
        <details class="asset-details">
          <summary>${t('multimodal_show_prompt', 'Show prompt & metadata')}</summary>
          <pre>${escapeHtml(JSON.stringify({ prompt: asset.prompt, status: asset.status, url: asset.url }, null, 2))}</pre>
        </details>` : ''}
    </article>
  `;
}

// ── Tab: Overview ─────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  function paint() {
    const assets = collectAssets();
    const images = assets.filter(a => (a.type || '').toUpperCase() === 'IMAGE').length;
    const videos = assets.filter(a => (a.type || '').toUpperCase() === 'VIDEO').length;
    const ratios = new Set(assets.map(a => a.aspect_ratio).filter(Boolean));
    const last = assets[0];

    panel.innerHTML = `
      <div class="metric-row">
        <div class="metric-box">
          <span class="metric-label">${t('multimodal_metric_total', 'Total Assets')}</span>
          <span class="metric-value">${assets.length}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('multimodal_metric_images', 'Images')}</span>
          <span class="metric-value">${images}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('multimodal_metric_videos', 'Videos')}</span>
          <span class="metric-value">${videos}</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">${t('multimodal_metric_ratios', 'Aspect Ratios')}</span>
          <span class="metric-value">${ratios.size}</span>
        </div>
      </div>

      ${assets.length
        ? renderOverviewBody(assets, last)
        : `<p class="muted">${t('multimodal_no_assets', 'No assets yet — Campaigns will populate this once Multimodal runs.')}</p>`}
    `;
    setStatus(assets.length ? t('multimodal_status_ready', 'Ready') : t('metric_idle', 'Idle'));
  }
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('AssetsGenerated', paint);
  return () => { try { unsub(); } catch {} };
}

function renderOverviewBody(assets, last) {
  // Aspect ratio distribution
  const counts = {};
  for (const a of assets) counts[a.aspect_ratio] = (counts[a.aspect_ratio] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return `
    <div class="panel-card">
      <header class="panel-card-head"><h3>${t('multimodal_distribution', 'Asset Distribution')}</h3></header>
      <div class="panel-card-body">
        <div class="ratio-bars">
          ${rows.map(([r, n]) => `
            <div class="ratio-bar">
              <span class="ratio-bar-label">${escapeHtml(r)}</span>
              <div class="ratio-bar-track"><div class="ratio-bar-fill" style="width:${(n / max * 100).toFixed(0)}%"></div></div>
              <span class="ratio-bar-count">${n}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="panel-card">
      <header class="panel-card-head">
        <h3>${t('multimodal_last_gen', 'Last Generation')}</h3>
        <span class="muted tiny">${fmtTime(last?.generated_at)}</span>
      </header>
      <div class="panel-card-body">
        <div class="asset-grid mini">
          ${assets.slice(0, 4).map(a => renderAssetCard(a)).join('')}
        </div>
      </div>
    </div>
  `;
}

// ── Tab: Library ──────────────────────────────────────────────────
let libraryState = { type: 'all', ratio: 'all' };

function renderLibrary(panel) {
  function paint() {
    const all = collectAssets();
    const filtered = all.filter(a => {
      const typeOk  = libraryState.type === 'all'
        || (a.type || '').toUpperCase() === libraryState.type.toUpperCase();
      const ratioOk = libraryState.ratio === 'all' || a.aspect_ratio === libraryState.ratio;
      return typeOk && ratioOk;
    });

    panel.innerHTML = `
      <div class="library-toolbar">
        <div class="filter-group">
          <span class="filter-label">${t('multimodal_filter_type', 'Type')}</span>
          ${['all', 'image', 'video'].map(v => `
            <button type="button" class="multi-chip ${libraryState.type === v ? 'active' : ''}" data-filter-type="${v}">${v}</button>
          `).join('')}
        </div>
        <div class="filter-group">
          <span class="filter-label">${t('multimodal_filter_ratio', 'Ratio')}</span>
          <button type="button" class="multi-chip ${libraryState.ratio === 'all' ? 'active' : ''}" data-filter-ratio="all">all</button>
          ${KNOWN_RATIOS.map(r => `
            <button type="button" class="multi-chip ${libraryState.ratio === r ? 'active' : ''}" data-filter-ratio="${r}">${r}</button>
          `).join('')}
        </div>
        <span class="muted tiny library-count">${filtered.length} / ${all.length}</span>
      </div>

      ${filtered.length
        ? `<div class="asset-grid">${filtered.map(a => renderAssetCard(a, { showCampaign: true, expandable: true })).join('')}</div>`
        : `<div class="dag-empty"><p>${all.length
              ? t('multimodal_no_match', 'No assets match the current filter.')
              : t('multimodal_no_assets_short', 'No assets yet.')}</p></div>`}
    `;

    panel.querySelectorAll('[data-filter-type]').forEach(btn => {
      btn.addEventListener('click', () => { libraryState.type = btn.dataset.filterType; paint(); });
    });
    panel.querySelectorAll('[data-filter-ratio]').forEach(btn => {
      btn.addEventListener('click', () => { libraryState.ratio = btn.dataset.filterRatio; paint(); });
    });
  }
  paint();

  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('AssetsGenerated', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Playground ───────────────────────────────────────────────
let playgroundState = null;
let lastPlaygroundOut = null;

function defaultPlaygroundState() {
  return {
    type: 'image',
    topic: 'eco water bottle',
    style: 'vibrant',
    brandColors: ['#6366f1', '#a855f7'],
    channels: ['tiktok', 'meta'],
    duration: 15,
  };
}

function renderPlayground(panel) {
  if (!playgroundState) playgroundState = defaultPlaygroundState();
  const agent = getAgent();
  if (!agent) {
    panel.innerHTML = `<p class="muted">${t('multimodal_agent_unavailable', 'Multimodal agent not available.')}</p>`;
    return;
  }

  function paint() {
    panel.innerHTML = `
      <div class="replan-banner">
        ${icon('sparkles', 'sm')}
        <span>${t('multimodal_play_warning', 'Preview mode · Does not write back to any campaign.')}</span>
      </div>
      <div class="whatif-layout playground-layout">
        <form class="config-form" data-pg-form>
          <div class="form-row">
            <label>${t('multimodal_form_type', 'Type')}</label>
            <div class="chip-multiselect">
              ${['image', 'video'].map(v => `
                <button type="button" class="multi-chip ${playgroundState.type === v ? 'active' : ''}" data-pg-type="${v}">${v}</button>
              `).join('')}
            </div>
          </div>
          <div class="form-row">
            <label>${t('multimodal_form_topic', 'Topic')}</label>
            <input type="text" class="modal-input" id="pg-topic" value="${escapeHtml(playgroundState.topic)}">
          </div>
          <div class="form-row">
            <label>${t('multimodal_form_style', 'Style')}</label>
            <div class="chip-multiselect">
              ${STYLES.map(s => `
                <button type="button" class="multi-chip ${playgroundState.style === s ? 'active' : ''}" data-pg-style="${s}">${s}</button>
              `).join('')}
            </div>
          </div>
          <div class="form-row">
            <label>${t('multimodal_form_colors', 'Brand colors')}</label>
            <div class="color-row">
              <input type="color" id="pg-color-0" value="${playgroundState.brandColors[0]}">
              <input type="color" id="pg-color-1" value="${playgroundState.brandColors[1]}">
            </div>
          </div>
          <div class="form-row">
            <label>${t('multimodal_form_channels', 'Channels')}</label>
            <div class="chip-multiselect">
              ${KNOWN_CHANNELS.map(c => `
                <button type="button" class="multi-chip ${playgroundState.channels.includes(c) ? 'active' : ''}" data-pg-channel="${c}">${c}</button>
              `).join('')}
            </div>
          </div>
          ${playgroundState.type === 'video' ? `
            <div class="form-row">
              <label>${t('multimodal_form_duration', 'Duration (sec)')}</label>
              <input type="number" class="modal-input" id="pg-duration" min="5" max="120" step="5" value="${playgroundState.duration}">
            </div>` : ''}
          <div class="form-actions">
            <span class="muted tiny" data-pg-status></span>
            <button type="button" class="btn btn-secondary" id="pg-copy" disabled>${t('planner_replan_copy', 'Copy as JSON')}</button>
            <button type="button" class="btn btn-primary"   id="pg-run">${t('multimodal_form_run', 'Generate preview')}</button>
          </div>
        </form>

        <div class="whatif-preview playground-preview" data-pg-preview>
          <p class="muted">${t('multimodal_play_hint', 'Run preview to see generated assets.')}</p>
        </div>
      </div>
    `;

    panel.querySelectorAll('[data-pg-type]').forEach(btn => btn.addEventListener('click', () => {
      playgroundState.type = btn.dataset.pgType;
      paint();
    }));
    panel.querySelectorAll('[data-pg-style]').forEach(btn => btn.addEventListener('click', () => {
      playgroundState.style = btn.dataset.pgStyle;
      panel.querySelectorAll('[data-pg-style]').forEach(b => b.classList.toggle('active', b === btn));
    }));
    panel.querySelectorAll('[data-pg-channel]').forEach(btn => btn.addEventListener('click', () => {
      const ch = btn.dataset.pgChannel;
      const set = new Set(playgroundState.channels);
      set.has(ch) ? set.delete(ch) : set.add(ch);
      playgroundState.channels = [...set];
      btn.classList.toggle('active');
    }));

    panel.querySelector('#pg-run').addEventListener('click', runPreview);
    panel.querySelector('#pg-copy').addEventListener('click', copyJson);
  }

  async function runPreview() {
    playgroundState.topic = panel.querySelector('#pg-topic')?.value ?? '';
    playgroundState.brandColors = [
      panel.querySelector('#pg-color-0')?.value || playgroundState.brandColors[0],
      panel.querySelector('#pg-color-1')?.value || playgroundState.brandColors[1],
    ];
    if (playgroundState.type === 'video') {
      playgroundState.duration = Number(panel.querySelector('#pg-duration')?.value) || 15;
    }
    const statusEl = panel.querySelector('[data-pg-status]');
    statusEl.textContent = t('multimodal_play_running', 'Generating…');
    try {
      const out = await agent.run({
        type:         playgroundState.type,
        topic:        playgroundState.topic,
        style:        playgroundState.style,
        brand_colors: playgroundState.brandColors,
        channels:     playgroundState.channels.length ? playgroundState.channels : ['tiktok'],
        duration:     playgroundState.duration,
        campaign_id:  'multimodal-preview',
      });
      lastPlaygroundOut = out;
      renderPreview(out);
      panel.querySelector('#pg-copy').disabled = false;
      statusEl.textContent = t('multimodal_play_ok', 'Preview ready');
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  function renderPreview(out) {
    const previewEl = panel.querySelector('[data-pg-preview]');
    const meta = out.metadata || {};
    previewEl.innerHTML = `
      ${meta.prompt ? `<p class="muted tiny pg-prompt">${escapeHtml(meta.prompt)}</p>` : ''}
      <div class="asset-grid mini">${(out.assets || []).map(a => renderAssetCard(a, { expandable: true })).join('')}</div>
    `;
  }

  async function copyJson() {
    if (!lastPlaygroundOut) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastPlaygroundOut, null, 2));
      panel.querySelector('[data-pg-status]').textContent = t('planner_replan_copy_done', 'Copied');
    } catch {
      panel.querySelector('[data-pg-status]').textContent = 'clipboard denied';
    }
  }

  paint();
}

// ── Tab: Runs ─────────────────────────────────────────────────────
function renderRuns(panel) {
  function paint() {
    const events = assetEvents().slice().reverse();
    if (!events.length) {
      panel.innerHTML = `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`;
      return;
    }
    panel.innerHTML = `<ul class="runs-list">${events.map(renderRunRow).join('')}</ul>`;
    panel.querySelectorAll('.run-row').forEach(row => {
      row.addEventListener('click', () => row.classList.toggle('expanded'));
    });
  }

  function renderRunRow(e) {
    const ids = e.payload?.asset_ids || [];
    return `
      <li class="run-row" data-id="${e.id}">
        <header class="run-row-head">
          <span class="run-row-time">${fmtTime(e.occurred_at)}</span>
          <span class="run-row-summary">${ids.length} ${e.payload?.type || 'asset'}(s) · ${(e.campaign_id || '').slice(0, 8)}…</span>
          <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
          ${icon('chevron-down', 'sm')}
        </header>
        <div class="run-row-body">
          <pre>${escapeHtml(JSON.stringify(e.payload, null, 2))}</pre>
        </div>
      </li>
    `;
  }

  paint();
  const ctx = getCtx();
  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe('AssetsGenerated', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Logs ─────────────────────────────────────────────────────
function renderLogs(panel) {
  function paint() {
    const events = assetEvents();
    panel.innerHTML = `
      <div class="logs-view">
        ${events.length
          ? events.slice().reverse().map(e => {
              const summary = `${e.payload?.type || 'asset'} × ${(e.payload?.asset_ids || []).length} · ${(e.campaign_id || '').slice(0, 8)}…`;
              return `
                <div class="log-line">
                  <span class="log-time">${fmtTime(e.occurred_at)}</span>
                  <span class="log-type">${e.event_type}</span>
                  <span class="log-msg">${escapeHtml(summary)}</span>
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
  const unsub = ctx.eventBus.subscribe('AssetsGenerated', paint);
  return () => { try { unsub(); } catch {} };
}

// ── Page module ───────────────────────────────────────────────────
let frame = null;

export default {
  titleKey: 'page_multimodal_title',

  async mount(outlet, ctx) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    const requestedTab = ctx?.query?.tab;

    frame = createAgentFrame({
      agent,
      runLabelKey: 'multimodal_form_run',
      runLabelFallback: 'Playground',
      runIconName: 'sparkles',
      onRun: () => frame?.renderTab('playground'),
      defaultTabId: requestedTab || 'overview',
      tabs: [
        { id: 'overview',   labelKey: 'agent_tab_overview',     label: 'Overview',   icon: 'activity', render: renderOverview },
        { id: 'library',    labelKey: 'multimodal_tab_library', label: 'Library',    icon: 'image',    render: renderLibrary },
        { id: 'playground', labelKey: 'multimodal_tab_play',    label: 'Playground', icon: 'sparkles', render: renderPlayground },
        { id: 'runs',       labelKey: 'agent_tab_runs',         label: 'Runs',       icon: 'clock',    render: renderRuns },
        { id: 'logs',       labelKey: 'agent_tab_logs',         label: 'Logs',       icon: 'activity', render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
  },
};
