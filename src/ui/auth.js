/*
 * Auth shell — login modal + current-user chip — Phase 1A.
 *
 * Tokens live in localStorage so they survive page reloads. The login
 * modal opens automatically when:
 *   • no access token is present on boot, OR
 *   • any API call returns 401 (api/routes.js dispatches `auth:unauthorized`).
 *
 * Real deployments will probably want a dedicated /login route and an
 * httpOnly cookie; this is the minimum to gate Phase-1A governance.
 */

const TOKEN_KEY   = 'oag_access_token';
const REFRESH_KEY = 'oag_refresh_token';
const USER_KEY    = 'oag_user';

export const auth = {
    getToken()  { return localStorage.getItem(TOKEN_KEY); },
    getUser()   {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
        catch { return null; }
    },
    isLoggedIn() { return !!this.getToken(); },
    hasGovRole(role) {
        const u = this.getUser();
        if (!u || !Array.isArray(u.gov_roles)) return false;
        const held = u.gov_roles.map(r => String(r).toUpperCase());
        return held.includes('ADMIN') || held.includes(String(role).toUpperCase());
    },
    setSession({ access_token, refresh_token, user }) {
        const wasAnonymous = !localStorage.getItem(TOKEN_KEY);
        localStorage.setItem(TOKEN_KEY, access_token);
        if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
        document.dispatchEvent(new CustomEvent('auth:login', { detail: { user } }));
        // Pages that already painted without a token (campaigns list, inbox,
        // etc.) won't refetch on their own — a reload is the cheapest way to
        // get them onto authenticated requests. Only do it on initial login,
        // not on re-login as the same user.
        if (wasAnonymous) setTimeout(() => location.reload(), 50);
    },
    clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
        document.dispatchEvent(new CustomEvent('auth:logout'));
    },
};

// ── Login modal ──────────────────────────────────────────────────────────────

function buildModal(api, { onSuccess } = {}) {
    const root = document.createElement('div');
    root.className = 'modal';
    root.style.display = 'flex';
    root.style.zIndex = '9999';
    root.innerHTML = `
      <div class="modal-content" style="max-width: 360px;">
        <header class="modal-header">
          <h3>Sign in</h3>
        </header>
        <div class="modal-body">
          <label style="font-size:12px; color: var(--text-secondary);">Email</label>
          <input class="modal-input" id="oag-login-email" type="email" autocomplete="email"
                 value="admin@openautogrowth.local" />
          <label style="font-size:12px; color: var(--text-secondary); margin-top: 8px;">Password</label>
          <input class="modal-input" id="oag-login-pwd" type="password" autocomplete="current-password"
                 value="admin1234" />
          <p id="oag-login-err" style="color: var(--danger); min-height: 18px; margin-top: 4px; font-size: 12px;"></p>
        </div>
        <footer class="modal-footer">
          <button class="btn btn-primary" id="oag-login-go">Sign in</button>
        </footer>
      </div>
    `;
    document.body.appendChild(root);

    const errEl = root.querySelector('#oag-login-err');
    const submit = async () => {
        const email = root.querySelector('#oag-login-email').value.trim();
        const pwd   = root.querySelector('#oag-login-pwd').value;
        errEl.textContent = 'Signing in…';
        const resp = await api.login(email, pwd);
        if (!resp?.success) {
            errEl.textContent = resp?.error || 'login failed';
            return;
        }
        auth.setSession(resp.data);
        root.remove();
        if (typeof onSuccess === 'function') onSuccess(resp.data.user);
    };
    root.querySelector('#oag-login-go').addEventListener('click', submit);
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => root.querySelector('#oag-login-pwd')?.focus(), 0);
    return root;
}

let _modalOpen = false;
export function ensureLoggedIn(api) {
    if (auth.isLoggedIn() || _modalOpen) return Promise.resolve(auth.getUser());
    _modalOpen = true;
    return new Promise(resolve => {
        buildModal(api, {
            onSuccess: (user) => { _modalOpen = false; resolve(user); },
        });
    });
}

// Auto-open login on 401.
document.addEventListener('auth:unauthorized', () => {
    if (!_modalOpen && window.OAG?.api) ensureLoggedIn(window.OAG.api);
});


// ── Notification preferences modal (Phase 2) ─────────────────────────────────

export async function openNotifyPrefs(api) {
    const resp = await api.getMyNotifyPrefs();
    const prefs = resp?.success ? resp.data : {};

    const root = document.createElement('div');
    root.className = 'modal';
    root.style.display = 'flex';
    root.style.zIndex = '9999';
    root.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <header class="modal-header"><h3>Notification settings</h3></header>
        <div class="modal-body">
          <label class="tiny">Slack incoming-webhook URL</label>
          <input class="modal-input" id="np-slack" placeholder="https://hooks.slack.com/services/…" value="${prefs.slack_webhook || ''}" />
          <label class="tiny" style="margin-top:8px;">DingTalk webhook URL</label>
          <input class="modal-input" id="np-ding" placeholder="https://oapi.dingtalk.com/robot/send?access_token=…" value="${prefs.dingtalk_webhook || ''}" />
          <label class="tiny" style="margin-top:8px;">DingTalk signing secret <span class="muted">(optional)</span></label>
          <input class="modal-input" id="np-dsec" type="password" placeholder="${prefs.dingtalk_secret_set ? '••••••• (set)' : 'leave blank for keyword/IP mode'}" />
          <label class="tiny" style="margin-top:8px;">Disabled channels <span class="muted">(comma-separated: EMAIL, SLACK, DINGTALK)</span></label>
          <input class="modal-input" id="np-off" placeholder="e.g. EMAIL" value="${prefs.notify_channels_disabled || ''}" />
          <p id="np-err" style="color:var(--danger); font-size:12px; min-height:16px;"></p>
        </div>
        <footer class="modal-footer">
          <button class="btn" id="np-cancel">Cancel</button>
          <button class="btn btn-primary" id="np-save">Save</button>
        </footer>
      </div>
    `;
    document.body.appendChild(root);
    root.querySelector('#np-cancel').onclick = () => root.remove();
    root.querySelector('#np-save').onclick = async () => {
        const payload = {
            slack_webhook:    root.querySelector('#np-slack').value.trim(),
            dingtalk_webhook: root.querySelector('#np-ding').value.trim(),
            // Empty input = leave unchanged; user has to clear it via the
            // dedicated "disabled channels" mechanism. PATCH treats null as
            // "no change", so omit if empty.
            notify_channels_disabled: root.querySelector('#np-off').value.trim(),
        };
        const secret = root.querySelector('#np-dsec').value;
        if (secret) payload.dingtalk_secret = secret;
        const r = await api.updateMyNotifyPrefs(payload);
        if (!r?.success) {
            root.querySelector('#np-err').textContent = r?.error || 'save failed';
            return;
        }
        root.remove();
    };
}
