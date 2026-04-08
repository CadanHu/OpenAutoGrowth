/**
 * Analysis Agent — 数据采集与归因
 * 重构版：按 docs/architecture/01-agent-design.md 规范
 */
import { globalEventBus } from '../core/EventBus.js';

export class AnalysisAgent {
    constructor() {
        this.agentType = 'ANALYSIS';
    }

    /**
     * @param {object} params
     * @param {string[]} params.metrics - ['CTR', 'ROI', 'Reach']
     * @param {string}   params.campaign_id
     * @param {object}   params.context - 上游 Task 结果（ad_ids 等）
     */
    async run(params) {
        const { metrics = ['CTR', 'ROAS'], campaign_id, context = {} } = params;

        console.log(`[Analysis] 📊 Pulling data for campaign: ${campaign_id}`);
        await this._simulateLatency(1000);

        // 构造绩效报告（生产环境替换为真实 API 调用）
        const report = this._buildReport(campaign_id, context);

        globalEventBus.publish('ReportGenerated', {
            report_id:   report.report_id,
            metrics:     report.summary,
            anomalies:   report.anomalies,
        }, campaign_id);

        return report;
    }

    _buildReport(campaign_id, context) {
        const ctr  = parseFloat((Math.random() * 0.06 + 0.02).toFixed(4));  // 2%~8%
        const roas = parseFloat((Math.random() * 3 + 1.5).toFixed(2));       // 1.5x~4.5x
        const spend = 25000 + Math.random() * 10000;

        const report = {
            report_id:   `rpt_${Date.now()}`,
            campaign_id,
            period:       { start: '2026-04-01', end: '2026-04-08' },
            summary:      {
                spend:       Math.round(spend),
                revenue:     Math.round(spend * roas),
                impressions: Math.round(Math.random() * 500000 + 100000),
                clicks:      Math.round(Math.random() * 5000 + 1000),
                conversions: Math.round(Math.random() * 200 + 50),
                ctr, roas,
                roi:         parseFloat((roas - 1).toFixed(2)),
            },
            by_variant: [
                { copy_id: 'copy_vA', ctr: ctr * 1.2, cvr: 0.032, roas: roas * 1.15 },
                { copy_id: 'copy_vB', ctr: ctr * 0.8, cvr: 0.020, roas: roas * 0.85 },
            ],
            anomalies: ctr < 0.025 ? [{
                channel:     'meta',
                metric:      'ctr',
                severity:    'HIGH',
                change_pct:  -0.35,
                description: 'CTR 大幅低于历史均值',
            }] : [],
        };

        // 计算规则引擎所需的派生字段
        report.rule_context = {
            metrics: {
                ...report.summary,
                ctr_below_baseline_70pct:    ctr < 0.035 * 0.7,
                roas_exceeds_target_120pct:  roas >= 3.0 * 1.2,
            },
            ab_test: {
                winner_confidence:    0.97,
                min_sample_size_met:  true,
                loser_variant_id:     'copy_vB',
            },
            anomalies: {
                cpm_surge_pct: 0.1,
                ctr_drop_pct:  ctr < 0.025 ? 0.45 : 0.05,
            },
        };

        return report;
    }

    _simulateLatency(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
