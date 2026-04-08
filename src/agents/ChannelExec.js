/**
 * ChannelExec Agent — 渠道执行（平台API集成层）
 * 实现：按 docs/architecture/01-agent-design.md 规范
 */
import { globalEventBus } from '../core/EventBus.js';

export class ChannelExecAgent {
    constructor() {
        this.agentType = 'CHANNEL_EXEC';
        // 模拟各平台 Adapter（生产环境替换为真实 SDK）
        this.adapters = {
            tiktok: new MockAdsAdapter('TikTok'),
            meta:   new MockAdsAdapter('Meta'),
            google: new MockAdsAdapter('Google'),
        };
    }

    /**
     * @param {object} params
     * @param {string[]} params.channel - 从 Strategy 输出中获取
     * @param {object}   params.context - 上游结果（含 assets，copies，strategy）
     * @param {string}   params.campaign_id
     */
    async run(params) {
        const { campaign_id, context = {} } = params;

        // 从上游收集资源
        const copies   = context?.t2?.variants || [];      // ContentGen 结果
        const assets   = context?.t3?.assets    || [];     // Multimodal 结果
        const strategy = context?.t1 || {};                // Strategy 结果

        const channelPlan = strategy.channel_plan || [
            { channel: 'tiktok', budget: 20000 },
            { channel: 'meta',   budget: 15000 },
        ];

        console.log(`[ChannelExec] 📡 Deploying to ${channelPlan.length} channels...`);

        const deployResults = await Promise.all(
            channelPlan.map(plan => this._deployToChannel(plan, copies, assets, campaign_id))
        );

        const output = {
            agent:        this.agentType,
            campaign_id,
            ad_campaigns: deployResults,
            status:       'ACTIVE',
            deployed_at:  new Date().toISOString(),
        };

        globalEventBus.publish('AdDeployed', {
            ad_campaign_ids: deployResults.map(r => r.campaign_id),
            platforms:       deployResults.map(r => r.platform),
        }, campaign_id);

        return output;
    }

    async _deployToChannel(plan, copies, assets, campaignId) {
        const adapter = this.adapters[plan.channel];
        if (!adapter) {
            console.warn(`[ChannelExec] No adapter for channel: ${plan.channel}`);
            return { platform: plan.channel, status: 'SKIPPED' };
        }

        await this._simulateLatency(800);

        const externalCampaignId = await adapter.createCampaign({ budget: plan.budget });
        const adIds = await Promise.all(
            copies.slice(0, 2).map(copy => adapter.createAd({ copy, assets }))
        );

        console.log(`[ChannelExec] ✅ ${plan.channel}: Campaign ${externalCampaignId}, ${adIds.length} Ads`);

        return {
            platform:    plan.channel,
            campaign_id: externalCampaignId,
            ad_ids:      adIds,
            status:      'ACTIVE',
            spend_cap:   plan.budget,
        };
    }

    _simulateLatency(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/** 平台 API Mock（生产环境替换为真实 SDK） */
class MockAdsAdapter {
    constructor(platformName) { this.platform = platformName; }

    async createCampaign({ budget }) {
        return `${this.platform.toLowerCase()}_camp_${Date.now()}`;
    }

    async createAd({ copy, assets }) {
        return `${this.platform.toLowerCase()}_ad_${Date.now()}_${copy?.id || 'x'}`;
    }
}
