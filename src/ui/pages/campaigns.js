/*
 * Campaigns Page — v0.2 target. Placeholder for now (opens the existing
 * global campaign-history modal so the data is still reachable).
 */

import { i18n }   from '../../i18n/index.js';
import { icon }   from '../icons.js';
import { router } from '../router.js';

export default {
  titleKey: 'page_campaigns_title',

  async mount(outlet) {
    outlet.innerHTML = `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/">${i18n.t('nav_hub') || 'Hub'}</a>
        ${icon('chevron-right', 'sm')}
        <span class="breadcrumb-current">${i18n.t('nav_campaigns') || 'Campaigns'}</span>
      </nav>

      <header class="section-header">
        <h1 tabindex="-1">${i18n.t('page_campaigns_title')}</h1>
        <p>${i18n.t('page_campaigns_sub') || '查看活动历史与绩效。'}</p>
      </header>

      <section class="placeholder-panel">
        <div class="placeholder-card">
          <span class="placeholder-icon">${icon('sparkles', 'lg')}</span>
          <h2>${i18n.t('placeholder_title') || '即将上线'}</h2>
          <p>${i18n.t('placeholder_campaigns_body') || '活动管理界面即将升级。当前仍可通过 Hub 的入口查看历史活动。'}</p>
          <button id="btn-back-hub-c" class="btn btn-primary">
            ${icon('arrow-left', 'sm')}
            <span>${i18n.t('btn_back_hub') || '返回 Hub'}</span>
          </button>
        </div>
      </section>
    `;

    document.getElementById('btn-back-hub-c')?.addEventListener('click', () => router.navigate('/'));
  },

  unmount() {},
};
