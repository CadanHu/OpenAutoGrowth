/*
 * Users & Tenants — ADMIN-only management page (Phase 1B).
 *
 * Two stacked sections: Tenants on top, Users below. Both are CRUD-lite —
 * create + grant/revoke roles only. Deletion is intentionally NOT exposed
 * here; the audit trail of a deleted user/tenant matters more than a clean
 * UI affordance, and disabling via `is_active` covers the common case.
 */
import { i18n } from '../../i18n/index.js';
import { icon } from '../icons.js';

const t = (k, fb) => {
  const v = i18n.t(k);
  return (v === k) ? (fb ?? k) : v;
};

const GOV_ROLES = ['FINANCE', 'LEGAL', 'BRAND_LEAD', 'MARKETING_DIRECTOR', 'ADMIN', 'AI'];

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function mount(outlet) {
  const ctx = window.OAG;
  const api = ctx.api;
  const me = ctx.auth?.getUser?.();
  const isAdmin = me?.gov_roles?.map(r => r.toUpperCase()).includes('ADMIN');

  if (!isAdmin) {
    outlet.innerHTML = `
      <main class="page-container">
        <h1 class="page-title">${t('users_page_title','Users & Tenants')}</h1>
        <p class="muted">${t('users_admin_only', 'Admin role required.')}</p>
      </main>`;
    return;
  }

  outlet.innerHTML = `
    <main class="page-container">
      <h1 class="page-title">${t('users_page_title','Users & Tenants')}</h1>
      <div id="users-page-body"></div>
    </main>
  `;
  const body = outlet.querySelector('#users-page-body');

  async function paint() {
    const [tenantsResp, usersResp] = await Promise.all([
      api.listTenants(),
      api.listUsers(),
    ]);
    const tenants = tenantsResp?.success ? tenantsResp.data : [];
    const users   = usersResp?.success   ? usersResp.data   : [];
    const tenantById = new Map(tenants.map(tn => [tn.id, tn]));

    body.innerHTML = `
      <section class="panel-card" style="margin-bottom: 24px;">
        <header class="panel-card-head" style="display:flex; justify-content:space-between; align-items:center;">
          <h3>${icon('database','sm')} ${t('users_section_tenants','Tenants')}
            <span class="tiny muted" style="margin-left:6px;">(${tenants.length})</span>
          </h3>
          <button class="btn btn-primary btn-sm" id="btn-new-tenant">
            ${icon('plus','sm')} ${t('users_btn_new_tenant','New tenant')}
          </button>
        </header>
        <div class="panel-card-body">
          <table class="attr-table">
            <thead><tr>
              <th>${t('users_form_tenant_name','Name')}</th>
              <th>${t('users_form_tenant_slug','Slug')}</th>
              <th>ID</th>
            </tr></thead>
            <tbody>
              ${tenants.length === 0 ? `<tr><td colspan="3" class="muted">—</td></tr>` :
                tenants.map(tn => `
                  <tr>
                    <td>${escapeHtml(tn.name)}</td>
                    <td><code class="code-inline">${escapeHtml(tn.slug)}</code></td>
                    <td class="tiny muted">${escapeHtml(tn.id)}</td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel-card">
        <header class="panel-card-head" style="display:flex; justify-content:space-between; align-items:center;">
          <h3>${icon('user','sm')} ${t('users_section_users','Users')}
            <span class="tiny muted" style="margin-left:6px;">(${users.length})</span>
          </h3>
          <button class="btn btn-primary btn-sm" id="btn-new-user">
            ${icon('plus','sm')} ${t('users_btn_new','New user')}
          </button>
        </header>
        <div class="panel-card-body">
          <table class="attr-table">
            <thead><tr>
              <th>${t('users_col_email','Email')}</th>
              <th>${t('users_col_role','User role')}</th>
              <th>${t('users_col_tenant','Tenant')}</th>
              <th>${t('users_col_gov_roles','Governance roles')}</th>
              <th>${t('users_col_active','Active')}</th>
              <th>${t('orch_col_action','Action')}</th>
            </tr></thead>
            <tbody>
              ${users.map(u => {
                const tn = u.tenant_id ? tenantById.get(u.tenant_id) : null;
                const held = (u.gov_roles || []).map(r => r.toUpperCase());
                return `
                  <tr data-user-id="${escapeHtml(u.id)}">
                    <td>${escapeHtml(u.email)}</td>
                    <td><code class="code-inline">${escapeHtml(u.role)}</code></td>
                    <td class="tiny">${tn ? escapeHtml(tn.slug) : '<span class="muted">—</span>'}</td>
                    <td>
                      ${held.length === 0 ? '<span class="muted tiny">—</span>' :
                        held.map(r => `<span class="cred-status-sandbox" style="margin-right:4px;">${escapeHtml(r)}</span>`).join('')}
                    </td>
                    <td class="tiny">${u.is_active ? '✓' : '✗'}</td>
                    <td>
                      <select class="modal-input role-pick" data-user-id="${escapeHtml(u.id)}"
                              style="width:auto; display:inline-block; padding:2px 6px; font-size:11px;">
                        ${GOV_ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}
                      </select>
                      <button class="btn btn-xs grant-btn" data-user-id="${escapeHtml(u.id)}">
                        ${t('users_btn_grant','Grant')}
                      </button>
                      <button class="btn btn-xs revoke-btn" data-user-id="${escapeHtml(u.id)}" style="margin-left:4px;">
                        ${t('users_btn_revoke','Revoke')}
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <p id="users-feedback" class="tiny muted" style="margin-top:8px; min-height: 18px;"></p>
        </div>
      </section>
    `;

    const fb = body.querySelector('#users-feedback');
    const say = (msg, kind) => {
      if (!fb) return;
      fb.textContent = msg;
      fb.style.color = kind === 'error' ? 'var(--danger)' : kind === 'success' ? 'var(--success)' : 'var(--text-tertiary)';
    };

    body.querySelector('#btn-new-tenant').addEventListener('click', () => openTenantModal(api, paint, say));
    body.querySelector('#btn-new-user').addEventListener('click',   () => openUserModal(api, tenants, paint, say));

    body.querySelectorAll('.grant-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.userId;
        const sel = body.querySelector(`.role-pick[data-user-id="${uid}"]`);
        const role = sel?.value;
        if (!role) return;
        const resp = await api.grantGovRole(uid, role);
        if (resp?.success) { say(`${t('users_btn_grant','Grant')} ${role} ✓`, 'success'); paint(); }
        else say(resp?.error || 'grant failed', 'error');
      });
    });
    body.querySelectorAll('.revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.userId;
        const sel = body.querySelector(`.role-pick[data-user-id="${uid}"]`);
        const role = sel?.value;
        if (!role) return;
        const resp = await api.revokeGovRole(uid, role);
        if (resp?.success) { say(`${t('users_btn_revoke','Revoke')} ${role} ✓`, 'success'); paint(); }
        else say(resp?.error || 'revoke failed', 'error');
      });
    });
  }

  await paint();
}

export default { titleKey: 'users_page_title', mount };

// ── Modals ─────────────────────────────────────────────────────────────────

function openTenantModal(api, onDone, say) {
  const root = document.createElement('div');
  root.className = 'modal';
  root.style.display = 'flex';
  root.innerHTML = `
    <div class="modal-content" style="max-width:360px;">
      <header class="modal-header"><h3>${t('users_form_new_tenant','Create tenant')}</h3></header>
      <div class="modal-body">
        <label class="tiny">${t('users_form_tenant_name','Name')}</label>
        <input class="modal-input" id="tn-name" />
        <label class="tiny" style="margin-top:8px;">${t('users_form_tenant_slug','Slug')}</label>
        <input class="modal-input" id="tn-slug" placeholder="acme-corp" />
        <p id="tn-err" style="color:var(--danger); font-size:12px; min-height:16px;"></p>
      </div>
      <footer class="modal-footer">
        <button class="btn" id="tn-cancel">${t('users_form_cancel','Cancel')}</button>
        <button class="btn btn-primary" id="tn-go">${t('users_form_create','Create')}</button>
      </footer>
    </div>`;
  document.body.appendChild(root);
  const err = root.querySelector('#tn-err');
  root.querySelector('#tn-cancel').onclick = () => root.remove();
  root.querySelector('#tn-go').onclick = async () => {
    const name = root.querySelector('#tn-name').value.trim();
    const slug = root.querySelector('#tn-slug').value.trim();
    if (!name || !slug) { err.textContent = 'name & slug required'; return; }
    const resp = await api.createTenant({ name, slug });
    if (!resp?.success) { err.textContent = resp?.error || 'failed'; return; }
    root.remove();
    say?.(`${t('users_form_new_tenant','Tenant')} ${name} ✓`, 'success');
    onDone?.();
  };
}

function openUserModal(api, tenants, onDone, say) {
  const root = document.createElement('div');
  root.className = 'modal';
  root.style.display = 'flex';
  root.innerHTML = `
    <div class="modal-content" style="max-width:400px;">
      <header class="modal-header"><h3>${t('users_form_new_user','Create user')}</h3></header>
      <div class="modal-body">
        <label class="tiny">${t('users_form_email','Email')}</label>
        <input class="modal-input" id="u-email" />
        <label class="tiny" style="margin-top:8px;">${t('users_form_password','Password')}</label>
        <input class="modal-input" id="u-pwd" type="password" />
        <label class="tiny" style="margin-top:8px;">${t('users_form_role','User role')}</label>
        <select class="modal-input" id="u-role">
          <option value="MARKETER">MARKETER</option>
          <option value="ADMIN">ADMIN</option>
          <option value="VIEWER">VIEWER</option>
        </select>
        <label class="tiny" style="margin-top:8px;">${t('users_form_tenant','Tenant')}</label>
        <select class="modal-input" id="u-tenant">
          ${tenants.map(tn => `<option value="${escapeHtml(tn.id)}">${escapeHtml(tn.slug)}</option>`).join('')}
        </select>
        <label class="tiny" style="margin-top:8px;">${t('users_form_gov_roles','Governance roles (comma-separated)')}</label>
        <input class="modal-input" id="u-gov" placeholder="FINANCE,LEGAL" />
        <p id="u-err" style="color:var(--danger); font-size:12px; min-height:16px;"></p>
      </div>
      <footer class="modal-footer">
        <button class="btn" id="u-cancel">${t('users_form_cancel','Cancel')}</button>
        <button class="btn btn-primary" id="u-go">${t('users_form_create','Create')}</button>
      </footer>
    </div>`;
  document.body.appendChild(root);
  const err = root.querySelector('#u-err');
  root.querySelector('#u-cancel').onclick = () => root.remove();
  root.querySelector('#u-go').onclick = async () => {
    const email = root.querySelector('#u-email').value.trim();
    const password = root.querySelector('#u-pwd').value;
    const role = root.querySelector('#u-role').value;
    const tenant_id = root.querySelector('#u-tenant').value;
    const govRaw = root.querySelector('#u-gov').value.trim();
    const gov_roles = govRaw ? govRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    if (!email || password.length < 8) { err.textContent = 'email + password (≥8 chars) required'; return; }
    const resp = await api.createUser({ email, password, role, tenant_id, gov_roles });
    if (!resp?.success) { err.textContent = resp?.error || 'failed'; return; }
    root.remove();
    say?.(`${t('users_form_new_user','User')} ${email} ✓`, 'success');
    onDone?.();
  };
}
