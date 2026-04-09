/**
 * CampaignAPI — 对接后端 REST API (:9393)
 * 替换原内存模拟层，所有操作通过 fetch 调用 FastAPI 后端。
 */

const API_BASE = 'http://localhost:9393/v1';

export class CampaignAPI {
    constructor() {
        // orchestrator/memory 参数保留以兼容 main.js 构造调用，但实际不使用
    }

    // ── POST /v1/campaigns ─────────────────────────────────────────────────

    async createCampaign(body) {
        return this._request('POST', '/campaigns', body);
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

    // ── GET /v1/campaigns/:id/events ─────────────────────────────────────

    async getCampaignEvents(id) {
        return this._request('GET', `/campaigns/${id}/events`);
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
            const json = await res.json();

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
