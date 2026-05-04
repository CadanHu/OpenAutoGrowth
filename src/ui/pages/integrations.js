/**
 * Integrations Page — Redesigned Integration Hub with categorization and rich metadata.
 */
import { i18n } from '../../i18n/index.js';
import { icon } from '../icons.js';

const CATEGORIES = [
  { id: 'ads', nameKey: 'pipeline_header' },
  { id: 'social', name: 'Social & Content' }
];

const PLATFORMS = [
  { id: 'google', category: 'ads', nameKey: 'integration_platform_google', icon: 'search', color: '#4285F4' },
  { id: 'meta',   category: 'ads', nameKey: 'integration_platform_meta',   icon: 'facebook', color: '#1877F2' },
  { id: 'tiktok', category: 'ads', nameKey: 'integration_platform_tiktok', icon: 'music', color: '#EE1D52' },
  { id: 'wechat', category: 'social', nameKey: 'integration_platform_wechat', icon: 'message-circle', color: '#07C160' },
  { id: 'x',      category: 'ads', nameKey: 'integration_platform_x',      icon: 'twitter', color: '#000000' },
];

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

export default {
  titleKey: 'nav_integrations',

  async mount(outlet, { query }) {
    const api = window.OAG.api;
    const orgId = DEFAULT_ORG_ID;
    const isSuccess = query.status === 'success';
    
    let integrations = [];
    try {
      const resp = await api.listIntegrations(orgId);
      if (resp.success) integrations = resp.data;
    } catch (e) {
      console.error('[Integrations] Failed to fetch states', e);
    }

    const states = {};
    integrations.forEach(i => {
      states[i.platform] = { 
        connected: i.status === 'ACTIVE', 
        updated_at: i.updated_at 
      };
    });

    const renderCard = (p) => {
      const state = states[p.id] || { connected: false };
      const connected = state.connected;
      
      return `
        <div class="integration-card ${connected ? 'connected' : ''}" style="--brand-color: ${p.color}">
          <div class="card-head">
            <div class="platform-logo" style="background: ${p.color}15; color: ${p.color}">
              ${icon(p.icon, 'lg')}
            </div>
            ${connected ? `
              <div class="status-pill active">
                ${icon('check', 12)}
                ${i18n.t('integration_status_connected')}
              </div>
            ` : `
              <div class="status-pill">
                ${i18n.t('integration_status_disconnected')}
              </div>
            `}
          </div>
          <div class="card-body">
            <h3>${i18n.t(p.nameKey)}</h3>
            ${connected ? `
              <div class="meta-info">
                <p><span>Account:</span> ${p.id.toUpperCase()}_7721</p>
                <p><span>Synced:</span> ${state.updated_at ? new Date(state.updated_at).toLocaleDateString() : 'Just now'}</p>
              </div>
            ` : `
              <p class="description muted">Connect to enable autonomous deployment and optimization on this platform.</p>
            `}
          </div>
          <div class="card-foot">
            ${connected 
              ? `<button class="btn-manage" data-platform="${p.id}">${i18n.t('integration_btn_manage')}</button>`
              : `
                <button class="btn-connect" data-platform="${p.id}">${i18n.t('integration_btn_connect')}</button>
                <a href="#" class="simulate-link" data-platform="${p.id}">${i18n.t('integration_btn_simulate')}</a>
              `
            }
          </div>
        </div>
      `;
    };

    outlet.innerHTML = `
      ${isSuccess ? `
        <div class="success-banner">
          <div class="success-banner-content">
            ${icon('shield-check', 'md')}
            <span>Authorization successful! Your account has been connected.</span>
          </div>
          <button class="banner-close" onclick="this.parentElement.remove()">${icon('x', 'sm')}</button>
        </div>
      ` : ''}

      <div class="page-header">
        <div class="breadcrumb">
          <a href="#/">${i18n.t('nav_hub')}</a>
          ${icon('chevron-right', 'sm')}
          <span>${i18n.t('nav_integrations')}</span>
        </div>
        <h1>${i18n.t('integration_title')}</h1>
        <p class="subtitle">${i18n.t('integration_subtitle')}</p>
      </div>

      <div class="integrations-sections">
        <section class="category-group">
          <h2 class="category-title">Advertising Networks</h2>
          <div class="integrations-grid">
            ${PLATFORMS.filter(p => p.category === 'ads').map(renderCard).join('')}
          </div>
        </section>

        <section class="category-group">
          <h2 class="category-title">Social & Content</h2>
          <div class="integrations-grid">
            ${PLATFORMS.filter(p => p.category === 'social').map(renderCard).join('')}
          </div>
        </section>
      </div>

      <div class="security-footer">
        <div class="security-lock">${icon('shield-check', 'lg')}</div>
        <div class="security-text">
          <h4>Enterprise-Grade Security</h4>
          <p>${i18n.t('integration_help_text')}</p>
        </div>
      </div>

      <style>
        .success-banner {
          background: #ecfdf5;
          border: 1px solid #10b98133;
          color: #065f46;
          padding: var(--sp-4) var(--sp-6);
          border-radius: var(--radius-md);
          margin-bottom: var(--sp-8);
          display: flex;
          justify-content: space-between;
          align-items: center;
          animation: slideDown 0.4s ease-out;
        }
        @keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        
        .success-banner-content { display: flex; align-items: center; gap: var(--sp-3); font-weight: var(--fw-medium); }
        .banner-close { background: none; border: none; color: #065f46; cursor: pointer; padding: var(--sp-1); opacity: 0.6; }
        .banner-close:hover { opacity: 1; }

        .category-group { margin-bottom: var(--sp-12); }
        .category-title { 
          font-size: var(--fs-sm); 
          color: var(--text-tertiary); 
          text-transform: uppercase; 
          letter-spacing: 0.1em; 
          margin-bottom: var(--sp-6);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: var(--sp-2);
        }

        .integrations-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: var(--sp-6);
        }

        .integration-card {
          background: var(--bg-L1);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          padding: var(--sp-8);
          display: flex;
          flex-direction: column;
          gap: var(--sp-6);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .integration-card.connected {
          border-color: var(--brand-color);
          box-shadow: 0 10px 30px -10px var(--brand-color) 20;
        }

        .integration-card.connected::after {
          content: '';
          position: absolute;
          top: 0; right: 0;
          width: 80px; height: 80px;
          background: linear-gradient(135deg, transparent 50%, var(--brand-color) 10%);
          opacity: 0.05;
        }

        .platform-logo {
          width: 56px; height: 56px;
          border-radius: var(--radius-lg);
          display: flex; align-items: center; justify-content: center;
        }

        .status-pill {
          padding: var(--sp-1) var(--sp-3);
          border-radius: var(--radius-full);
          font-size: 10px;
          font-weight: var(--fw-bold);
          text-transform: uppercase;
          background: var(--bg-L2);
          color: var(--text-tertiary);
          display: flex; align-items: center; gap: 4px;
        }

        .status-pill.active {
          background: #ecfdf5;
          color: #10b981;
        }

        .card-head { display: flex; justify-content: space-between; align-items: flex-start; }
        
        .card-body h3 { 
          margin: 0 0 var(--sp-2); 
          font-size: var(--fs-xl); 
          font-family: var(--font-display); 
        }

        .meta-info { display: flex; flex-direction: column; gap: 4px; }
        .meta-info p { margin: 0; font-size: var(--fs-xs); color: var(--text-secondary); }
        .meta-info span { color: var(--text-tertiary); font-weight: var(--fw-medium); }

        .description { font-size: var(--fs-sm); line-height: 1.5; margin: 0; }

        .card-foot { margin-top: auto; padding-top: var(--sp-4); }

        .btn-connect, .btn-manage {
          width: 100%;
          padding: var(--sp-3);
          border-radius: var(--radius-md);
          font-weight: var(--fw-bold);
          cursor: pointer;
          transition: all 0.2s;
          font-family: var(--font-sans);
        }

        .btn-connect {
          background: var(--brand-color);
          color: white;
          border: none;
        }

        .btn-manage {
          background: transparent;
          border: 1px solid var(--brand-color);
          color: var(--brand-color);
        }

        .simulate-link {
          display: block;
          text-align: center;
          margin-top: var(--sp-3);
          font-size: var(--fs-xs);
          color: var(--text-tertiary);
          text-decoration: none;
          transition: color 0.2s;
        }

        .simulate-link:hover {
          color: var(--brand-color);
          text-decoration: underline;
        }

        .btn-connect:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 4px 12px var(--brand-color) 40; }
        .btn-manage:hover { background: var(--brand-color) 10; }

        .security-footer {
          margin-top: var(--sp-16);
          padding: var(--sp-8);
          background: var(--bg-L1);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          gap: var(--sp-6);
        }

        .security-lock { color: var(--text-tertiary); }
        .security-text h4 { margin: 0 0 4px; font-size: var(--fs-md); }
        .security-text p { margin: 0; font-size: var(--fs-sm); color: var(--text-secondary); }
      </style>
    `;

    // Bind events
    outlet.querySelectorAll('.btn-connect').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        window.location.href = api.getAuthorizeUrl(platform, orgId);
      });
    });

    outlet.querySelectorAll('.simulate-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const platform = link.dataset.platform;
        window.location.href = `${api.getAuthorizeUrl(platform, orgId)}&mock=true`;
      });
    });

    outlet.querySelectorAll('.btn-manage').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        window.location.hash = `#/integrations/${platform}`;
      });
    });
  },
};
