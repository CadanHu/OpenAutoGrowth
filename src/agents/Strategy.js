/**
 * Strategy Agent — 投放策略决策
 * 按 docs/architecture/01-agent-design.md 规范
 */
import { globalEventBus } from '../core/EventBus.js';

export class StrategyAgent {
    constructor() {
        this.agentType = 'STRATEGY';

        // 渠道基准 ROI 参考（生产环境从 Analytics 历史数据动态加载）
        this.channelBaselines = {
            tiktok: { avg_roas: 3.2, avg_ctr: 0.055, best_hours: [19, 20, 21, 22] },
            meta:   { avg_roas: 2.8, avg_ctr: 0.041, best_hours: [12, 13, 20, 21] },
            google: { avg_roas: 3.5, avg_ctr: 0.038, best_hours: [9, 10, 14, 15] },
            wechat: { avg_roas: 2.1, avg_ctr: 0.028, best_hours: [8, 12, 22, 23] },
        };
    }

    /**
     * @param {object} params
     * @param {string}   params.target      - 'cold_start' | 'lookalike_audience' | 'reach_maximize'
     * @param {string[]} params.channels    - 指定渠道列表（可选）
     * @param {object}   params.budget      - { total, currency }
     * @param {object}   params.kpi         - { metric, target }
     * @param {string}   params.campaign_id
     */
    async run(params) {
        const { target = 'cold_start', channels, budget = {}, kpi = {}, campaign_id } = params;

        console.log(`[Strategy] 🎯 Building channel plan | Target: ${target}`);
        await this._simulateLatency(800);

        const availableChannels = channels || ['tiktok', 'meta', 'google'];
        const scoredChannels = this._scoreChannels(availableChannels, target, kpi);
        const channelPlan = this._allocateBudget(scoredChannels, budget.total || 50000);
        const audienceConfig = this._buildAudience(target);
        const schedule = this._buildSchedule(scoredChannels);

        const output = {
            agent:        this.agentType,
            channel_plan: channelPlan,
            audience:     audienceConfig,
            schedule,
            ab_split: { variant_a: 0.6, variant_b: 0.4 },
            bid_rationale: this._buildRationale(scoredChannels),
        };

        globalEventBus.publish('StrategyDecided', { strategy: output }, campaign_id);
        return output;
    }

    _scoreChannels(channels, target, kpi) {
        return channels.map(ch => {
            const baseline = this.channelBaselines[ch] || { avg_roas: 2.0, avg_ctr: 0.03 };
            let score = baseline.avg_roas * 10;

            // 按目标调整评分
            if (target === 'cold_start' && ch === 'tiktok') score += 15;   // TikTok 冷启动强
            if (target === 'lookalike_audience' && ch === 'meta') score += 12; // Meta Lookalike 强
            if (target === 'reach_maximize' && ch === 'google') score += 10;

            // 按 KPI 调整
            if (kpi.metric === 'CTR' && baseline.avg_ctr > 0.04) score += 8;

            return { channel: ch, score: Math.round(score), baseline };
        }).sort((a, b) => b.score - a.score);
    }

    _allocateBudget(scoredChannels, totalBudget) {
        const totalScore = scoredChannels.reduce((s, c) => s + c.score, 0);

        return scoredChannels.map(c => {
            const weight = c.score / totalScore;
            const budget = Math.round(totalBudget * weight / 100) * 100; // 取整到百

            return {
                channel:       c.channel,
                score:         c.score,
                budget,
                bid_strategy:  c.baseline.avg_roas > 3.0 ? 'ROAS_TARGET' : 'CPM',
                bid_target:    c.baseline.avg_roas > 3.0 ? c.baseline.avg_roas : null,
                audience_size: target => `${Math.round(weight * 100)}% of total audience`,
            };
        });
    }

    _buildAudience(target) {
        const configs = {
            cold_start: {
                type: 'INTEREST_BASED',
                age: '18-35',
                interests: ['科技', '创业', '效率工具', 'SaaS'],
                geo: ['CN'],
                lookalike: null,
            },
            lookalike_audience: {
                type: 'LOOKALIKE',
                source: 'existing_customers',
                similarity: 0.7,
                geo: ['CN'],
            },
            reach_maximize: {
                type: 'BROAD',
                age: '18-50',
                geo: ['CN'],
                exclude: ['existing_customers'],
            },
        };
        return configs[target] || configs['cold_start'];
    }

    _buildSchedule(scoredChannels) {
        const bestChannel = scoredChannels[0];
        const bestHours = this.channelBaselines[bestChannel?.channel]?.best_hours || [20, 21];
        return {
            timezone: 'Asia/Shanghai',
            peak_hours: bestHours,
            pause_hours: [2, 3, 4, 5],  // 凌晨流量差，暂停节省预算
        };
    }

    _buildRationale(scored) {
        return scored.map(c =>
            `${c.channel.toUpperCase()}: Score ${c.score} (Avg ROAS ${c.baseline.avg_roas}x)`
        ).join(' | ');
    }

    _simulateLatency(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
