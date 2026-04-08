/**
 * API Routes — REST API Layer
 * 基于 Campaign 状态机设计，按 docs/architecture/07-data-flow-service-boundary.md 规范
 *
 * 生产环境：此文件对接 Express / Fastify；当前为纯 JS 模拟层，供 UI 调用。
 */
import { globalEventBus } from '../core/EventBus.js';

export class CampaignAPI {
    constructor({ orchestrator, memory } = {}) {
        this.orchestrator = orchestrator;
        this.memory       = memory;
        this.campaigns    = new Map(); // 简化存储；生产替换为 DB 层
    }

    /**
     * POST /v1/campaigns
     * 创建 Campaign（状态: DRAFT）
     */
    async createCampaign(body) {
        const { goal, budget, timeline, kpi, constraints, name } = body;

        // 输入校验
        if (!goal)          return this._error(400, 'goal is required');
        if (!budget?.total) return this._error(400, 'budget.total is required');
        if (!kpi?.metric)   return this._error(400, 'kpi.metric is required');

        const campaign = {
            campaign_id:      `camp_${Date.now()}`,
            name:             name || goal.slice(0, 60),
            goal,
            budget,
            timeline,
            kpi,
            constraints,
            status:           'DRAFT',
            loop_count:       0,
            created_at:       new Date().toISOString(),
            updated_at:       new Date().toISOString(),
        };

        this.campaigns.set(campaign.campaign_id, campaign);
        globalEventBus.publish('CampaignCreated', { campaign }, campaign.campaign_id);

        return this._ok(201, campaign);
    }

    /**
     * GET /v1/campaigns/:id
     */
    async getCampaign(id) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);
        return this._ok(200, campaign);
    }

    /**
     * GET /v1/campaigns
     */
    async listCampaigns({ status, limit = 20, offset = 0 } = {}) {
        let list = [...this.campaigns.values()];
        if (status) list = list.filter(c => c.status === status);
        return this._ok(200, {
            total: list.length,
            items: list.slice(offset, offset + limit),
        });
    }

    /**
     * POST /v1/campaigns/:id/start
     * 触发规划（DRAFT → PLANNING）
     */
    async startCampaign(id) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);

        const allowed = ['DRAFT'];
        if (!allowed.includes(campaign.status)) {
            return this._error(409, `Cannot start campaign in status: ${campaign.status}`);
        }

        this._updateStatus(campaign, 'PLANNING');
        console.log(`[API] Campaign ${id} → PLANNING`);

        // 异步触发 Orchestrator（非阻塞）
        if (this.orchestrator) {
            this.orchestrator.processGoal({
                goal:        campaign.goal,
                budget:      campaign.budget,
                timeline:    campaign.timeline,
                kpi:         campaign.kpi,
                constraints: campaign.constraints,
            }).catch(err => console.error('[API] Orchestrator error:', err));
        }

        return this._ok(202, { campaign_id: id, status: 'PLANNING', message: 'Campaign planning started' });
    }

    /**
     * POST /v1/campaigns/:id/approve
     * 人工审批通过（PENDING_REVIEW → PRODUCTION）
     */
    async approveCampaign(id, { reviewer } = {}) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);
        if (campaign.status !== 'PENDING_REVIEW') {
            return this._error(409, `Campaign must be PENDING_REVIEW to approve`);
        }

        this._updateStatus(campaign, 'PRODUCTION');
        campaign.approved_by  = reviewer || 'auto';
        campaign.approved_at  = new Date().toISOString();

        globalEventBus.publish('CampaignApproved', { reviewer }, id);
        return this._ok(200, { status: 'PRODUCTION', approved_by: campaign.approved_by });
    }

    /**
     * POST /v1/campaigns/:id/reject
     * 审批拒绝（PENDING_REVIEW → DRAFT）
     */
    async rejectCampaign(id, { reason } = {}) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);
        if (campaign.status !== 'PENDING_REVIEW') {
            return this._error(409, `Campaign must be PENDING_REVIEW to reject`);
        }

        this._updateStatus(campaign, 'DRAFT');
        campaign.rejection_reason = reason;
        return this._ok(200, { status: 'DRAFT', reason });
    }

    /**
     * POST /v1/campaigns/:id/pause
     * 人工暂停（任意活跃状态 → PAUSED）
     */
    async pauseCampaign(id, { reason } = {}) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);

        const pauseable = ['DEPLOYED', 'MONITORING', 'OPTIMIZING'];
        if (!pauseable.includes(campaign.status)) {
            return this._error(409, `Cannot pause campaign in status: ${campaign.status}`);
        }

        this._updateStatus(campaign, 'PAUSED');
        campaign.pause_reason = reason;
        globalEventBus.publish('CampaignPaused', { reason }, id);
        return this._ok(200, { status: 'PAUSED' });
    }

    /**
     * POST /v1/campaigns/:id/resume
     * 恢复（PAUSED → MONITORING）
     */
    async resumeCampaign(id) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);
        if (campaign.status !== 'PAUSED') {
            return this._error(409, `Campaign must be PAUSED to resume`);
        }

        this._updateStatus(campaign, 'MONITORING');
        return this._ok(200, { status: 'MONITORING' });
    }

    /**
     * POST /v1/campaigns/:id/stop
     * 终止（任意状态 → COMPLETED）
     */
    async stopCampaign(id, { reason } = {}) {
        const campaign = this.campaigns.get(id);
        if (!campaign) return this._error(404, `Campaign ${id} not found`);

        this._updateStatus(campaign, 'COMPLETED');
        campaign.stop_reason  = reason;
        campaign.completed_at = new Date().toISOString();

        globalEventBus.publish('CampaignCompleted', { reason }, id);
        return this._ok(200, { status: 'COMPLETED' });
    }

    /**
     * GET /v1/campaigns/:id/events
     * 查看领域事件日志
     */
    async getCampaignEvents(id) {
        const events = globalEventBus.getHistory(id);
        return this._ok(200, { campaign_id: id, total: events.length, events });
    }

    // ── Helpers ─────────────────────────────────────────────

    _updateStatus(campaign, newStatus) {
        const old = campaign.status;
        campaign.status     = newStatus;
        campaign.updated_at = new Date().toISOString();
        globalEventBus.publish('StatusChanged', { old_status: old, new_status: newStatus }, campaign.campaign_id);
        console.log(`[API] Campaign ${campaign.campaign_id}: ${old} → ${newStatus}`);
    }

    _ok(statusCode, data) {
        return { statusCode, success: true, data, timestamp: new Date().toISOString() };
    }

    _error(statusCode, message) {
        return { statusCode, success: false, error: message, timestamp: new Date().toISOString() };
    }
}
