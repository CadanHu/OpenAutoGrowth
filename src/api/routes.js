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
