/*
 * Agent Placeholder Page — visible when an agent's dedicated workbench
 * hasn't been built yet. Preserves navigation, validates tokens, offers
 * a path back to the Hub.
 *
 * See: docs/frontend/05-agent-page-template.md §5
 */

import { i18n }   from '../../i18n/index.js';
import { icon }   from '../icons.js';
import { router } from '../router.js';
import { AGENTS } from '../agent-registry.js';

export default {
  titleKey: 'page_agent_placeholder_title',

  async mount(outlet, { params }) {
    const agent = AGENTS[params.id];
    if (!agent) { router.navigate('/'); return; }

    outlet.innerHTML = `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/">${i18n.t('nav_hub') || 'Hub'}</a>
        ${icon('chevron-right', 'sm')}
        <span>${i18n.t('nav_agents') || 'Agents'}</span>
        ${icon('chevron-right', 'sm')}
        <span class="breadcrumb-current">${agent.name}</span>
      </nav>

      <header class="agent-header" style="--agent-color:${agent.color}">
        <div class="agent-header-id">
          <span class="agent-header-icon">${icon(agent.icon, 'lg')}</span>
          <div class="agent-header-text">
            <h1 tabindex="-1">${agent.name}</h1>
            <p>${agent.description}</p>
          </div>
        </div>
        <div class="agent-header-actions">
          <span class="badge badge-muted">${i18n.t('status_soon') || 'Coming Soon'}</span>
        </div>
      </header>

      <section class="placeholder-panel">
        <div class="placeholder-card">
          <span class="placeholder-icon">${icon('sparkles', 'lg')}</span>
          <h2>${i18n.t('placeholder_title') || '即将上线'}</h2>
          <p>${i18n.t('placeholder_body') || '该 Agent 的独立工作台正在开发中。完整工作台将支持配置、运行、历史、提示词版本管理与专属日志。'}</p>
          <button id="btn-back-hub" class="btn btn-primary">
            ${icon('arrow-left', 'sm')}
            <span>${i18n.t('btn_back_hub') || '返回 Hub'}</span>
          </button>
        </div>
      </section>
    `;

    document.getElementById('btn-back-hub')?.addEventListener('click', () => {
      router.navigate('/');
    });
  },

  unmount() {},
};
