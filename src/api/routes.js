/**
 * CampaignAPI — 对接后端 REST API (:9393)
 * 替换原内存模拟层，所有操作通过 fetch 调用 FastAPI 后端。
 */

const API_BASE = 'http://localhost:9393/v1';

export class CampaignAPI {
    constructor({ orchestrator, memory } = {}) {
        this.orchestrator = orchestrator;
        this.memory = memory;
    }

    // ── POST /v1/campaigns ─────────────────────────────────────────────────

    async createCampaign(body) {
        const resp = await this._request('POST', '/campaigns', body);
        if (!resp.success && String(resp.error).includes('Failed to fetch') && this.orchestrator) {
            console.warn('[API] Backend unreachable. Falling back to mock Orchestrator.');
            const result = await this.orchestrator.processGoal(body);
            return { success: true, data: { id: result.campaign_id, status: result.status, budget: body.budget } };
        }
        return resp;
    }

    async analyzeUrl(url, type = 'ecom') {
        return this._request('POST', '/campaigns/analyze-url', { url, campaign_type: type });
    }

    // ── GET /v1/campaigns ─────────────────────────────────────────────────

    async listCampaigns({ status, limit = 20, offset = 0 } = {}) {
        const params = new URLSearchParams({ limit, offset });
        if (status) params.set('status', status);
        return this._request('GET', `/campaigns?${params}`);
    }

    // ── GET /v1/campaigns/:id ─────────────────────────────────────────────

    async getCampaign(id) {
        return this._request('GET', `/campaigns/${id}`);
    }

    // ── POST /v1/campaigns/:id/start ──────────────────────────────────────

    async startCampaign(id) {
        return this._request('POST', `/campaigns/${id}/start`);
    }

    // ── POST /v1/campaigns/:id/pause ─────────────────────────────────────

    async pauseCampaign(id) {
        return this._request('POST', `/campaigns/${id}/pause`);
    }

    // ── POST /v1/campaigns/:id/resume ────────────────────────────────────

    async resumeCampaign(id) {
        return this._request('POST', `/campaigns/${id}/resume`);
    }

    // ── POST /v1/campaigns/:id/complete ──────────────────────────────────

    async completeCampaign(id) {
        return this._request('POST', `/campaigns/${id}/complete`);
    }

    async deleteCampaign(id) {
        return this._request('DELETE', `/campaigns/${id}`);
    }

    // ── GET /v1/campaigns/:id/events ─────────────────────────────────────

    async getCampaignEvents(id) {
        return this._request('GET', `/campaigns/${id}/events`);
    }

    async getCampaignUsage(id) {
        return this._request('GET', `/campaigns/${id}/usage`);
    }

    // ── GET /v1/campaigns/:id/memory ─────────────────────────────────────

    async getCampaignMemory(id, { limit = 20, memory_type } = {}) {
        const qs = new URLSearchParams();
        if (limit) qs.set('limit', String(limit));
        if (memory_type) qs.set('memory_type', memory_type);
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._request('GET', `/campaigns/${id}/memory${suffix}`);
    }

    // ── Global Events Aggregator (Frontend Helper) ────────────────────────
    
    async getSystemEvents(eventTypes = []) {
        try {
            const camps = await this.listCampaigns({ limit: 10 });
            if (!camps.success) return [];
            const promises = (camps.data?.items || []).map(c => this.getCampaignEvents(c.id || c.campaign_id));
            const results = await Promise.all(promises);
            let allEvents = [];
            results.forEach(r => {
                if (r.success && r.data?.events) allEvents.push(...r.data.events);
            });
            if (eventTypes && eventTypes.length > 0) {
                allEvents = allEvents.filter(e => eventTypes.includes(e.event_type));
            }
            return allEvents.sort((a,b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || '')));
        } catch (e) {
            console.warn('[API] getSystemEvents failed', e);
            return [];
        }
    }

    // ── Articles ──────────────────────────────────────────────────────────

    async listArticles(limit = 20, offset = 0) {
        return this._request('GET', `/articles?limit=${limit}&offset=${offset}`);
    }

    async deleteArticle(id) {
        return this._request('DELETE', `/articles/${id}`);
    }

    // ── Authentication & Integrations ────────────────────────────────────

    async listIntegrations(orgId) {
        return this._request('GET', `/auth/integrations?org_id=${orgId}`);
    }

    async disconnectPlatform(platform, orgId) {
        return this._request('DELETE', `/auth/integrations/${platform}?org_id=${orgId}`);
    }

    getAuthorizeUrl(platform, orgId) {
        return `${API_BASE}/auth/${platform}/authorize?org_id=${orgId}`;
    }

    // ── A2A Agents ────────────────────────────────────────────────────────

    /**
     * Call a backend agent directly (A2A style)
     */
    async callAgent(agentName, input) {
        const taskId = `task_${Math.random().toString(36).slice(2, 10)}`;
        const payload = {
            id: taskId,
            message: {
                role: 'user',
                parts: [{ type: 'text', text: JSON.stringify(input) }]
            }
        };

        const submitResp = await this._request('POST', `/agents/${agentName}/tasks/send`, payload);
        if (!submitResp.success) return submitResp;

        // Simple polling for result
        return this._pollTask(agentName, taskId);
    }

    async _pollTask(agentName, taskId, retry = 0) {
        // Timeout: 150 * 2s = 300 seconds
        if (retry > 150) return { success: false, error: 'Polling timeout' };

        await new Promise(r => setTimeout(r, 2000));
        const resp = await this._request('GET', `/agents/${agentName}/tasks/${taskId}`);

        if (!resp.success) return resp;

        const state = resp.data.status?.state;
        if (state === 'completed') {
            const artifact = resp.data.artifacts?.find(a => a.name === 'result');
            const text = artifact?.parts?.find(p => p.type === 'text')?.text;
            const data = text ? JSON.parse(text) : {};

            // Handle internal agent errors
            if (data.errors && data.errors.length > 0) {
                return { success: false, error: data.errors[0].error || 'Agent execution failed' };
            }

            return { success: true, data: data };
        } else if (state === 'failed' || state === 'canceled') {
            const error = resp.data.metadata?.error || `Task ${state}`;
            return { success: false, error: error };
        }

        return this._pollTask(agentName, taskId, retry + 1);
    }

    // ── Internal fetch helper ─────────────────────────────────────────────

    async _request(method, path, body = null) {
        try {
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' },
            };
            if (body) options.body = JSON.stringify(body);

            const res = await fetch(`${API_BASE}${path}`, options);

            // 204 No Content / empty body — don't try to parse JSON, that
            // throws "Unexpected end of JSON input" on success responses
            // (e.g. DELETE /v1/campaigns/:id).
            if (res.status === 204 || res.headers.get('content-length') === '0') {
                return res.ok
                    ? { success: true, data: {} }
                    : { success: false, error: `HTTP ${res.status}` };
            }

            // Read once as text so we can degrade gracefully on a non-JSON
            // body (e.g. an HTML error page from a misconfigured proxy).
            const text = await res.text();
            let json = {};
            if (text) {
                try { json = JSON.parse(text); }
                catch { json = { _raw: text }; }
            }

            if (!res.ok) {
                return {
                    success: false,
                    error: json.detail || json.error?.message || `HTTP ${res.status}`,
                };
            }

            // FastAPI returns data directly; normalize to { success, data } envelope
            return { success: true, data: json };
        } catch (err) {
            console.error(`[API] ${method} ${path} failed:`, err);
            return { success: false, error: err.message };
        }
    }
}
