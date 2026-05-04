/**
 * Integration Management Page — Redesigned with Premium Minimalist UI principles.
 * Follows [PREMIUM-UPGRADE] specifications in 01-design-system.md.
 */
import { i18n } from '../../i18n/index.js';
import { icon } from '../icons.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const PLATFORM_META = {
  google: { name: 'Google Ads', color: '#4285F4', icon: 'search' },
  meta:   { name: 'Meta Ads',   color: '#1877F2', icon: 'facebook' },
  tiktok: { name: 'TikTok',     color: '#EE1D52', icon: 'music' },
  wechat: { name: 'WeChat',     color: '#07C160', icon: 'message-circle' },
  x:      { name: 'X Ads',      color: '#000000', icon: 'twitter' },
};

export default {
  titleKey: 'nav_integrations',

  async mount(outlet, { params }) {
    const { platform } = params;
    const api = window.OAG.api;
    const orgId = DEFAULT_ORG_ID;
    const meta = PLATFORM_META[platform] || { name: platform, color: '#8B7355', icon: 'settings' };

    // 1. Fetch current status
    let credential = null;
    try {
      const resp = await api.listIntegrations(orgId);
      if (resp.success) {
        credential = resp.data.find(i => i.platform === platform);
      }
    } catch (e) {
      console.error('[Manage] Failed to fetch credential', e);
    }

    if (!credential) {
      outlet.innerHTML = `
        <div class="route-error premium-fade">
          <h1>Not Connected</h1>
          <p>This integration is no longer active.</p>
          <a href="#/integrations" class="btn-primary">Return to Hub</a>
        </div>`;
      return;
    }

    outlet.innerHTML = `
      <div class="manage-container premium-fade">
        <div class="page-header">
          <div class="breadcrumb">
            <a href="#/">${i18n.t('nav_hub')}</a>
            ${icon('chevron-right', 12)}
            <a href="#/integrations">${i18n.t('nav_integrations')}</a>
            ${icon('chevron-right', 12)}
            <span class="current">${meta.name}</span>
          </div>
          
          <div class="header-main">
            <div class="platform-brand" style="--brand-color: ${meta.color}">
              <div class="brand-logo">${icon(meta.icon, 'lg')}</div>
              <div class="brand-text">
                <h1>${i18n.t('int_manage_title').replace('{platform}', meta.name)}</h1>
                <p class="subtitle">${i18n.t('int_manage_subtitle').replace('{platform}', meta.name)}</p>
              </div>
            </div>
            <div class="status-indicator active">
               <span class="status-dot"></span>
               ${i18n.t('integration_status_connected')}
            </div>
          </div>
        </div>

        <div class="manage-content">
          <div class="content-left">
            <section class="premium-card">
              <h2 class="section-title">${i18n.t('int_manage_section_settings')}</h2>
              <div class="settings-grid">
                <div class="field-group">
                  <label>${i18n.t('int_manage_account_id')}</label>
                  <div class="readonly-field">
                    <span>${platform.toUpperCase()}_8823_9912</span>
                    ${icon('check', 14)}
                  </div>
                </div>
                <div class="field-group">
                  <label>Sync Environment</label>
                  <div class="readonly-field">Production (V18)</div>
                </div>
              </div>
            </section>

            <section class="premium-card">
              <h2 class="section-title">Automation Scope</h2>
              <p class="section-desc">Define which actions the AI Agents can perform on your behalf.</p>
              <div class="control-list">
                 <label class="control-item">
                   <div class="control-text">
                     <span class="control-label">Auto-Campaign Deployment</span>
                     <span class="control-hint">Allow Planner to create new campaigns.</span>
                   </div>
                   <input type="checkbox" checked class="premium-switch">
                 </label>
                 <label class="control-item">
                   <div class="control-text">
                     <span class="control-label">Creative A/B Testing</span>
                     <span class="control-hint">Allow Optimizer to swap assets.</span>
                   </div>
                   <input type="checkbox" checked class="premium-switch">
                 </label>
                 <label class="control-item disabled">
                   <div class="control-text">
                     <span class="control-label">Autonomous Budget Scaling</span>
                     <span class="control-hint">Allow real-time bid adjustments. (Enterprise Only)</span>
                   </div>
                   <input type="checkbox" disabled class="premium-switch">
                 </label>
              </div>
            </section>
          </div>

          <div class="content-right">
             <section class="premium-card info-card">
               <h2 class="section-title">Security & Sync</h2>
               <div class="info-list">
                 <div class="info-item">
                   <span class="label">${i18n.t('int_manage_last_sync')}</span>
                   <span class="val">${credential.updated_at ? new Date(credential.updated_at).toLocaleString() : 'Just now'}</span>
                 </div>
                 <div class="info-item">
                   <span class="label">Scope</span>
                   <span class="val">ads_management, reporting</span>
                 </div>
               </div>
               <div class="action-stack">
                 <button class="btn-outline w-full" id="btn-reconnect">
                   ${icon('activity', 16)}
                   ${i18n.t('int_manage_btn_reconnect')}
                 </button>
                 <button class="btn-danger-ghost w-full" id="btn-disconnect">
                   ${icon('x', 16)}
                   ${i18n.t('int_manage_btn_disconnect')}
                 </button>
               </div>
             </section>
          </div>
        </div>
      </div>

      <style>
        .premium-fade { animation: fadeIn 0.5s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .manage-container {
          max-width: 1100px;
          margin: 0 auto;
          padding: var(--sp-4) var(--sp-6);
          font-family: var(--font-sans);
          line-height: 1.628; /* Golden Ratio line height */
        }

        /* Header */
        .page-header { margin-bottom: var(--sp-10); }
        .header-main { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; /* Changed from flex-end */
          margin-top: var(--sp-4);
          gap: var(--sp-4);
        }
        
        .platform-brand { display: flex; align-items: center; gap: var(--sp-5); min-width: 0; }
        .brand-logo {
          width: 64px; height: 64px;
          background: var(--bg-L1);
          border: 1px solid rgba(0,0,0,0.05);
          border-radius: var(--radius-xl);
          display: flex; align-items: center; justify-content: center;
          color: var(--brand-color);
          box-shadow: var(--shadow-sm);
        }
        
        .brand-text h1 { 
          margin: 0; 
          font-family: var(--font-display); 
          font-size: var(--fs-h1); 
          letter-spacing: -0.01em;
        }
        .brand-text .subtitle { color: var(--text-secondary); margin: 4px 0 0; font-size: var(--fs-body); }

        .status-indicator {
          display: flex; align-items: center; gap: var(--sp-2);
          padding: var(--sp-2) var(--sp-4);
          background: #ecfdf5;
          color: #10b981;
          border-radius: var(--radius-full);
          font-weight: var(--fw-bold);
          font-size: var(--fs-xs);
          text-transform: uppercase;
          white-space: nowrap;
          flex-shrink: 0;
        }

        /* Layout Grid */
        .manage-content {
          display: grid;
          grid-template-columns: 1.8fr 1fr;
          gap: var(--sp-8);
        }

        /* Premium Card */
        .premium-card {
          background: var(--bg-L1);
          border: 1px solid rgba(0,0,0,0.05);
          border-radius: var(--radius-xl);
          padding: var(--sp-8);
          margin-bottom: var(--sp-8);
          box-shadow: var(--shadow-sm); /* Using the new multi-layered logic tokens */
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .premium-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }

        .section-title {
          font-size: var(--fs-sm);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-tertiary);
          margin: 0 0 var(--sp-6);
        }

        .section-desc { font-size: var(--fs-sm); color: var(--text-secondary); margin-bottom: var(--sp-6); }

        /* Settings Grid */
        .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-6); }
        .field-group label { display: block; font-size: var(--fs-xs); font-weight: var(--fw-medium); margin-bottom: 8px; }
        .readonly-field {
          background: var(--bg-L2);
          padding: var(--sp-3) var(--sp-4);
          border-radius: var(--radius-md);
          font-family: var(--font-mono);
          font-size: var(--fs-sm);
          display: flex; justify-content: space-between; align-items: center;
          color: var(--text-primary);
        }

        /* Control List */
        .control-list { display: flex; flex-direction: column; gap: var(--sp-4); }
        .control-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: var(--sp-4);
          border-radius: var(--radius-lg);
          background: var(--bg-L2);
          cursor: pointer;
          transition: background 0.2s;
        }
        .control-item:hover { background: var(--bg-L3); }
        .control-item.disabled { opacity: 0.5; cursor: not-allowed; }
        
        .control-text { display: flex; flex-direction: column; }
        .control-label { font-weight: var(--fw-semibold); font-size: var(--fs-sm); }
        .control-hint { font-size: var(--fs-xs); color: var(--text-tertiary); }

        /* Right Rail */
        .info-card { background: #fdfbf6; border-color: var(--border-default); }
        .info-list { margin-bottom: var(--sp-8); }
        .info-item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-subtle); }
        .info-item .label { font-size: var(--fs-sm); color: var(--text-tertiary); }
        .info-item .val { font-size: var(--fs-sm); font-weight: var(--fw-medium); }

        .action-stack { display: flex; flex-direction: column; gap: var(--sp-3); }
        
        .btn-outline, .btn-danger-ghost {
          display: flex; align-items: center; justify-content: center; gap: var(--sp-2);
          padding: var(--sp-3); border-radius: var(--radius-md);
          font-weight: var(--fw-bold); font-size: var(--fs-sm);
          cursor: pointer; transition: all 0.2s cubic-bezier(0.22, 0.61, 0.36, 1);
        }
        
        .btn-outline { border: 1px solid var(--border-default); background: white; color: var(--text-primary); }
        .btn-outline:hover { transform: scale(0.98); background: var(--bg-L2); }
        
        .btn-danger-ghost { border: none; background: transparent; color: var(--danger); }
        .btn-danger-ghost:hover { background: rgba(176, 74, 62, 0.05); transform: scale(0.98); }

        .w-full { width: 100%; }

        /* Premium Switch Mock */
        .premium-switch {
          appearance: none; width: 40px; height: 22px;
          background: var(--border-default);
          border-radius: 20px; position: relative; cursor: pointer;
          transition: background 0.3s;
        }
        .premium-switch:checked { background: #10b981; }
        .premium-switch::before {
          content: ''; position: absolute; top: 2px; left: 2px;
          width: 18px; height: 18px; background: white;
          border-radius: 50%; transition: transform 0.3s;
        }
        .premium-switch:checked::before { transform: translateX(18px); }
      </style>
    `;

    // 2. Bind events
    document.getElementById('btn-disconnect')?.addEventListener('click', async () => {
      if (confirm(i18n.t('int_manage_warn_disconnect'))) {
        const res = await api.disconnectPlatform(platform, orgId);
        if (res.success) {
          window.location.hash = '#/integrations';
        }
      }
    });

    document.getElementById('btn-reconnect')?.addEventListener('click', () => {
      window.location.href = api.getAuthorizeUrl(platform, orgId);
    });
  }
};
