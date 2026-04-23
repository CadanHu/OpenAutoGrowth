/*
 * ContentGen Agent Page — dedicated workbench.
 * Spec: docs/frontend/05-agent-page-template.md  (§3 tabs, §4 Variant Playground)
 *
 * Data sources (all read from window.OAG):
 *   - eventBus.history                → Runs, Logs tabs
 *   - api.variants / memory           → Overview "last run"
 *   - orchestrator.agents.ContentGen  → actual agent for Playground invoke
 *
 * Config / Prompt tabs are local-only in v0.0.2 (no backend endpoint yet).
 */

import { i18n }           from '../../i18n/index.js';
import { icon }           from '../icons.js';
import { router }         from '../router.js';
import { AGENTS }         from '../agent-registry.js';
import { createAgentFrame } from './agent-frame.js';

const AGENT_ID    = 'content-gen';
const AGENT_EVENT = 'ContentGenerated';

function getCtx() { return window.OAG || {}; }
function t(k, d) { return i18n.t(k) || d; }

// ── Small helpers ───────────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false });
}

function contentGenEvents() {
  const ctx = getCtx();
  return (ctx.eventBus?.history || []).filter(e => e.event_type === AGENT_EVENT);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Tab: Overview ───────────────────────────────────────────────────
function renderOverview(panel, { setStatus }) {
  const events = contentGenEvents();
  const last   = events[events.length - 1];
  const totalVariants = events.reduce((s, e) => s + (e.payload?.bundle?.variants?.length || 0), 0);

  panel.innerHTML = `
    <div class="metric-row">
      <div class="metric-box">
        <span class="metric-label">${t('metric_state', 'State')}</span>
        <span class="metric-value">${last ? t('status_completed', 'Completed') : t('metric_idle', 'Idle')}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('metric_variants', 'Variants')}</span>
        <span class="metric-value">${totalVariants}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('agent_runs', 'Runs')}</span>
        <span class="metric-value">${events.length}</span>
      </div>
      <div class="metric-box">
        <span class="metric-label">${t('agent_last_run', 'Last Run')}</span>
        <span class="metric-value">${last ? formatTime(last.occurred_at) : '—'}</span>
      </div>
    </div>

    <div class="panel-card">
      <header class="panel-card-head">
        <h3>${t('agent_last_summary', 'Last Run Summary')}</h3>
      </header>
      <div class="panel-card-body">
        ${last ? renderLastRunSummary(last) : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`}
      </div>
    </div>
  `;
  setStatus(events.length ? t('status_completed', 'Completed') : t('metric_idle', 'Idle'));
}

function renderLastRunSummary(event) {
  const variants = event.payload?.bundle?.variants || [];
  const meta     = event.payload?.bundle?.metadata || {};
  return `
    <div class="kv-grid">
      <div><span class="kv-k">${t('agent_campaign_id', 'Campaign')}</span><span class="kv-v">${event.campaign_id?.slice(0, 8) || '—'}…</span></div>
      <div><span class="kv-k">${t('agent_variant_count', 'Variants')}</span><span class="kv-v">${variants.length}</span></div>
      <div><span class="kv-k">${t('agent_avg_words', 'Avg. words')}</span><span class="kv-v">${meta.word_count_avg || '—'}</span></div>
      <div><span class="kv-k">${t('agent_time', 'Time')}</span><span class="kv-v">${formatTime(event.occurred_at)}</span></div>
    </div>
    <div class="variant-preview-strip">
      ${variants.slice(0, 3).map(v => `
        <article class="variant-card mini">
          <header>Variant ${escapeHtml(v.variant || '—')}</header>
          <p>${escapeHtml((v.hook || v.title || v.body || '').slice(0, 90))}…</p>
        </article>
      `).join('')}
    </div>
  `;
}

// ── Tab: Config (local-only in v0.0.2) ──────────────────────────────
const DEFAULT_CONFIG = {
  model: 'claude-3-5-sonnet',
  ab_variants: 3,
  tone: 'energetic',
  max_words: 120,
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(localStorage.getItem('oag.cfg.content-gen') || '{}')) };
  } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg) {
  localStorage.setItem('oag.cfg.content-gen', JSON.stringify(cfg));
}

function renderConfig(panel) {
  const cfg = loadConfig();
  panel.innerHTML = `
    <form class="config-form" data-cfg-form>
      <div class="form-row">
        <label>${t('cfg_model', 'LLM Model')}</label>
        <select name="model" class="modal-input">
          <option value="claude-3-5-sonnet" ${cfg.model === 'claude-3-5-sonnet' ? 'selected' : ''}>Claude 3.5 Sonnet</option>
          <option value="gpt-4o" ${cfg.model === 'gpt-4o' ? 'selected' : ''}>GPT-4o</option>
          <option value="gemini-3" ${cfg.model === 'gemini-3' ? 'selected' : ''}>Gemini 3</option>
        </select>
      </div>
      <div class="form-row">
        <label>${t('cfg_ab_variants', 'A/B Variants')}: <span data-ab-n>${cfg.ab_variants}</span></label>
        <input type="range" name="ab_variants" min="1" max="6" value="${cfg.ab_variants}">
      </div>
      <div class="form-row">
        <label>${t('cfg_tone', 'Tone')}</label>
        <select name="tone" class="modal-input">
          <option value="energetic"    ${cfg.tone === 'energetic'    ? 'selected' : ''}>Energetic</option>
          <option value="professional" ${cfg.tone === 'professional' ? 'selected' : ''}>Professional</option>
          <option value="warm"         ${cfg.tone === 'warm'         ? 'selected' : ''}>Warm</option>
        </select>
      </div>
      <div class="form-row">
        <label>${t('cfg_max_words', 'Max Words')}</label>
        <input type="number" name="max_words" class="modal-input" value="${cfg.max_words}" min="30" max="500">
      </div>
      <div class="form-actions">
        <span class="muted tiny">${t('cfg_local_note', 'Saved locally for now — backend sync coming soon.')}</span>
        <button type="submit" class="btn btn-primary">${t('btn_save', 'Save')}</button>
      </div>
    </form>
  `;

  const form = panel.querySelector('[data-cfg-form]');
  const abDisplay = panel.querySelector('[data-ab-n]');
  form.addEventListener('input', (e) => {
    if (e.target.name === 'ab_variants') abDisplay.textContent = e.target.value;
  });
  const onSubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    saveConfig({
      model:       fd.get('model'),
      ab_variants: Number(fd.get('ab_variants')),
      tone:        fd.get('tone'),
      max_words:   Number(fd.get('max_words')),
    });
    flashToast(panel, t('cfg_saved', 'Saved'));
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}

function flashToast(panel, msg) {
  const el = document.createElement('div');
  el.className = 'inline-toast';
  el.textContent = msg;
  panel.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ── Tab: Runs ───────────────────────────────────────────────────────
function renderRuns(panel) {
  const events = contentGenEvents().slice().reverse();
  panel.innerHTML = events.length
    ? `<ul class="runs-list">${events.map(renderRunRow).join('')}</ul>`
    : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`;

  panel.querySelectorAll('.run-row').forEach(row => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
}

function renderRunRow(event) {
  const variants = event.payload?.bundle?.variants || [];
  return `
    <li class="run-row" data-id="${event.id}">
      <header class="run-row-head">
        <span class="run-row-time">${formatTime(event.occurred_at)}</span>
        <span class="run-row-summary">${variants.length} variants · campaign ${event.campaign_id?.slice(0, 6) || '—'}…</span>
        <span class="run-row-status ok">${t('status_completed', 'OK')}</span>
        ${icon('chevron-down', 'sm')}
      </header>
      <div class="run-row-body">
        <pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
      </div>
    </li>
  `;
}

// ── Tab: Prompt ─────────────────────────────────────────────────────
const DEFAULT_PROMPT = `You are ContentGen for {{product.name}}.
Audience: {{target_persona.age}}, interests: {{target_persona.interest}}.
Channels: {{channels}}. Tone: {{tone}}.
Produce {{ab_variants}} A/B copy variants.
Each variant: hook (<=18 words), body (<={{max_words}} words), cta.`;

function renderPrompt(panel) {
  const saved = localStorage.getItem('oag.prompt.content-gen') || DEFAULT_PROMPT;
  panel.innerHTML = `
    <div class="prompt-editor">
      <div class="prompt-tools">
        <span class="muted tiny">${t('prompt_variables_hint', 'Variables: {{product.name}}, {{tone}}, {{ab_variants}}, {{channels}}…')}</span>
        <button class="btn btn-ghost" data-prompt-reset>${t('btn_reset_default', 'Reset to Default')}</button>
      </div>
      <textarea class="modal-textarea" data-prompt-ta>${escapeHtml(saved)}</textarea>
      <div class="form-actions">
        <span class="muted tiny">${t('prompt_versioning_soon', 'Version history coming soon.')}</span>
        <button class="btn btn-primary" data-prompt-save>${t('btn_save', 'Save')}</button>
      </div>
    </div>
  `;
  const ta = panel.querySelector('[data-prompt-ta]');
  const onSave  = () => { localStorage.setItem('oag.prompt.content-gen', ta.value); flashToast(panel, t('cfg_saved', 'Saved')); };
  const onReset = () => { ta.value = DEFAULT_PROMPT; };
  panel.querySelector('[data-prompt-save]').addEventListener('click', onSave);
  panel.querySelector('[data-prompt-reset]').addEventListener('click', onReset);
}

// ── Tab: Logs ───────────────────────────────────────────────────────
function renderLogs(panel) {
  const ctx = getCtx();
  const history = (ctx.eventBus?.history || []).filter(e =>
    e.event_type === AGENT_EVENT || e.event_type === 'TaskCompleted' && e.payload?.agent === 'ContentGen'
  );
  panel.innerHTML = `
    <div class="logs-view">
      ${history.length
        ? history.slice().reverse().map(e => `
          <div class="log-line">
            <span class="log-time">${formatTime(e.occurred_at)}</span>
            <span class="log-type">${e.event_type}</span>
            <span class="log-msg">${e.payload?.bundle?.variants?.length || 0} variants</span>
          </div>
        `).join('')
        : `<p class="muted">${t('no_recent_event', 'No recent event')}</p>`
      }
    </div>
  `;

  if (!ctx.eventBus) return;
  const unsub = ctx.eventBus.subscribe(AGENT_EVENT, () => renderLogs(panel));
  return () => { try { unsub(); } catch {} };
}

// ── Tab: Playground (specialization) ────────────────────────────────
function renderPlayground(panel) {
  panel.innerHTML = `
    <form class="playground-form" data-pg-form>
      <div class="form-row">
        <label>${t('pg_product_name', 'Product Name')}</label>
        <input name="product_name" class="modal-input" placeholder="DataPulse">
      </div>
      <div class="form-row">
        <label>${t('pg_usp', 'USPs (comma-separated)')}</label>
        <input name="usp" class="modal-input" placeholder="Real-time, Low-latency, Open-source">
      </div>
      <div class="form-row form-row-inline">
        <div>
          <label>${t('pg_tone', 'Tone')}</label>
          <select name="tone" class="modal-input">
            <option value="energetic">Energetic</option>
            <option value="professional">Professional</option>
            <option value="warm">Warm</option>
          </select>
        </div>
        <div>
          <label>${t('pg_variants_n', 'Variants')}</label>
          <input name="n" type="number" class="modal-input" value="3" min="1" max="6">
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">
          ${icon('sparkles', 'sm')} <span>${t('pg_generate', 'Generate')}</span>
        </button>
      </div>
    </form>
    <div class="playground-results" data-pg-results></div>
  `;

  const form    = panel.querySelector('[data-pg-form]');
  const results = panel.querySelector('[data-pg-results]');

  const onSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const ctx = getCtx();
    const agent = ctx.orchestrator?.agents?.get?.('ContentGen')
               || ctx.orchestrator?.agents?.ContentGen;
    if (!agent) {
      results.innerHTML = `<p class="muted">${t('pg_agent_unavailable', 'ContentGen agent not available.')}</p>`;
      return;
    }

    results.innerHTML = `<div class="tab-loading"><span class="dot pulse"></span></div>`;

    try {
      const out = await agent.run({
        product: {
          name: fd.get('product_name') || 'DataPulse',
          USP: String(fd.get('usp') || '').split(',').map(s => s.trim()).filter(Boolean),
        },
        target_persona: { age: '25-35', interest: ['tech'] },
        channels: ['tiktok'],
        tone: fd.get('tone'),
        ab_variants: Number(fd.get('n')) || 3,
        campaign_id: 'playground-' + Date.now().toString(36),
      });
      renderPlaygroundOutput(results, out.variants || []);
    } catch (err) {
      results.innerHTML = `<p class="tab-error">${err.message}</p>`;
    }
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}

function renderPlaygroundOutput(el, variants) {
  if (!variants.length) {
    el.innerHTML = `<p class="muted">${t('pg_no_output', 'No variants generated.')}</p>`;
    return;
  }
  el.innerHTML = `
    <div class="variant-grid">
      ${variants.map(v => `
        <article class="variant-card">
          <header><span class="variant-badge">${escapeHtml(v.variant || '?')}</span> ${escapeHtml(v.hook || v.title || '')}</header>
          <p>${escapeHtml(v.body || '')}</p>
          <footer>
            <span class="variant-meta">${escapeHtml(v.cta || '')}</span>
            <span class="variant-meta muted">${escapeHtml(v.tone || '')}</span>
          </footer>
        </article>
      `).join('')}
    </div>
  `;
}

// ── Page module ─────────────────────────────────────────────────────
let frame = null;

export default {
  titleKey: 'page_agent_placeholder_title',

  async mount(outlet) {
    const agent = AGENTS[AGENT_ID];
    if (!agent) { router.navigate('/'); return; }

    frame = createAgentFrame({
      agent,
      tabs: [
        { id: 'overview',   labelKey: 'agent_tab_overview',   label: 'Overview',   icon: 'activity',   render: renderOverview },
        { id: 'playground', labelKey: 'agent_tab_playground', label: 'Playground', icon: 'sparkles',   render: renderPlayground },
        { id: 'config',     labelKey: 'agent_tab_config',     label: 'Config',     icon: 'settings',   render: renderConfig },
        { id: 'runs',       labelKey: 'agent_tab_runs',       label: 'Runs',       icon: 'clock',      render: renderRuns },
        { id: 'prompt',     labelKey: 'agent_tab_prompt',     label: 'Prompt',     icon: 'pen-line',   render: renderPrompt },
        { id: 'logs',       labelKey: 'agent_tab_logs',       label: 'Logs',       icon: 'activity',   render: renderLogs },
      ],
    });

    frame.mount(outlet);
  },

  unmount() {
    frame?.unmount();
    frame = null;
  },
};
