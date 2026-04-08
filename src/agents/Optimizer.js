/**
 * Optimizer Agent — 自动优化闭环核心
 * 重构版：集成 RuleEngine，按 docs/architecture/01-agent-design.md I/O 规范
 */
import { RuleEngine } from '../core/RuleEngine.js';
import { globalEventBus } from '../core/EventBus.js';

export class OptimizerAgent {
    constructor() {
        this.agentType  = 'OPTIMIZER';
        this.ruleEngine = new RuleEngine();

        // 监听分析报告
        globalEventBus.subscribe('ReportGenerated', e => this._onReport(e));
    }

    async run(params) {
        const { context = {}, campaign_id } = params;
        // 从上游 Analysis Task 获取报告
        const report = context?.t5 || params.report;  // t5 = Analysis task result
        if (!report) {
            console.warn('[Optimizer] No report available, skipping.');
            return { actions: [], next_loop: { trigger: false } };
        }

        return await this._optimize(report, campaign_id);
    }

    async _onReport({ payload, campaign_id }) {
        console.log(`[Optimizer] 🔔 Report received for ${campaign_id}, starting analysis...`);
        // 事件驱动触发（在 Monitoring 阶段由事件触发）
    }

    async _optimize(report, campaign_id) {
        console.log(`[Optimizer] ⚙️ Running rule engine...`);

        const ruleContext = report.rule_context || {};
        ruleContext.campaign = { loop_count: 0 };

        const actions = this.ruleEngine.evaluate(ruleContext, campaign_id || 'default');

        await this._simulateLatency(500);

        const output = {
            agent:     this.agentType,
            report_id: report.report_id,
            actions,
            confidence: 0.92,
            next_loop: {
                trigger:     actions.some(a => ['TRIGGER_REWRITE', 'REALLOCATE_BUDGET', 'SCALE_BUDGET'].includes(a.type)),
                loop_count:  (report.campaign?.loop_count || 0) + 1,
            }
        };

        if (actions.length > 0) {
            globalEventBus.publish('OptimizationApplied', {
                actions,
                report_id: report.report_id,
                loop_count: output.next_loop.loop_count,
            }, campaign_id);
        }

        console.log(`[Optimizer] Actions: ${actions.map(a => a.type).join(', ') || 'NONE'}`);
        return output;
    }

    _simulateLatency(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
