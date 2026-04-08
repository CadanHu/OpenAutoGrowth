/**
 * Orchestrator Agent — 总控大脑
 * 重构版：严格按照 docs/architecture/01-agent-design.md I/O 规范
 */
import { globalEventBus } from '../core/EventBus.js';

export class Orchestrator {
    constructor({ planner, memory, ruleEngine } = {}) {
        this.planner    = planner;
        this.memory     = memory;
        this.ruleEngine = ruleEngine;
        this.agents     = new Map();    // Map<AgentType, Agent>
        this.campaigns  = new Map();    // Map<campaignId, CampaignState>

        // 订阅关键事件
        globalEventBus.subscribe('PlanGenerated',          e => this._onPlanGenerated(e));
        globalEventBus.subscribe('ContentApproved',        e => this._onContentApproved(e));
        globalEventBus.subscribe('AdDeployed',             e => this._onAdDeployed(e));
        globalEventBus.subscribe('OptimizationApplied',    e => this._onOptimizationApplied(e));
        globalEventBus.subscribe('AnomalyDetected',        e => this._onAnomalyDetected(e));
    }

    registerAgent(agentType, agent) {
        this.agents.set(agentType, agent);
        console.log(`[Orchestrator] Registered agent: ${agentType}`);
    }

    /**
     * 主入口：接收用户目标，创建 Campaign，开始规划
     * @param {object} goalInput - 符合 docs/01-agent-design.md Orchestrator 输入规范
     */
    async processGoal(goalInput) {
        const { goal, budget, timeline, kpi, constraints } = goalInput;

        const campaign = {
            campaign_id:  `camp_${Date.now()}`,
            name:          goal.substring(0, 50),
            status:        'PLANNING',
            loop_count:    0,
            plan_id:       null,
            active_tasks:  [],
            budget,
            kpi,
        };

        this.campaigns.set(campaign.campaign_id, campaign);
        console.log(`[Orchestrator] 🎯 New campaign: ${campaign.campaign_id} | Goal: ${goal}`);

        // 检索历史记忆
        const history = this.memory?.getSimilar?.(goal) || null;

        // 委托 Planner 生成 DAG
        const plan = await this.planner.createPlan({ goal, budget, kpi, constraints, history });
        campaign.plan_id = plan.id;

        globalEventBus.publish('PlanGenerated', { plan, campaign_id: campaign.campaign_id }, campaign.campaign_id);
        return { campaign_id: campaign.campaign_id, status: 'PLANNING', plan_preview: plan };
    }

    /**
     * 依赖感知的并发 DAG 执行器
     */
    async executePlan(campaignId, plan) {
        const campaign = this.campaigns.get(campaignId);
        if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

        const results = {};
        const pending = [...plan.tasks];

        while (pending.length > 0) {
            // 找出依赖全部完成的就绪任务
            const ready = pending.filter(task =>
                !task.dependencies?.length ||
                task.dependencies.every(depId => results[depId] !== undefined)
            );

            if (ready.length === 0) {
                console.error('[Orchestrator] ⚠️ DAG deadlock detected');
                break;
            }

            // 并发执行所有就绪任务
            await Promise.all(ready.map(async task => {
                const agent = this.agents.get(task.agentType);
                if (!agent) {
                    console.error(`[Orchestrator] No agent registered for: ${task.agentType}`);
                    return;
                }

                campaign.active_tasks.push(task.id);
                console.log(`[Orchestrator] → Dispatch "${task.id}" to ${task.agentType}`);

                try {
                    const result = await agent.run({
                        ...task.params,
                        campaign_id: campaignId,
                        context: results,     // 上游结果传递
                    });
                    results[task.id] = result;
                    this.memory?.save?.(`${campaignId}:${task.id}`, result);
                } catch (err) {
                    console.error(`[Orchestrator] Task ${task.id} failed:`, err.message);
                    results[task.id] = { error: err.message };
                } finally {
                    campaign.active_tasks = campaign.active_tasks.filter(id => id !== task.id);
                    pending.splice(pending.indexOf(task), 1);
                }
            }));
        }

        return results;
    }

    // ── 事件处理器 ──────────────────────────────────────────
    async _onPlanGenerated({ payload: { plan, campaign_id } }) {
        const campaign = this.campaigns.get(campaign_id);
        if (!campaign) return;
        campaign.status = 'PENDING_REVIEW';
        console.log(`[Orchestrator] Plan ready. Campaign → PENDING_REVIEW`);
        // TODO: 触发 Review Gate 逻辑
        // 简化：自动审批后直接执行
        await this.executePlan(campaign_id, plan);
    }

    _onContentApproved({ payload, campaign_id }) {
        console.log(`[Orchestrator] Content approved for ${campaign_id}`);
    }

    _onAdDeployed({ payload, campaign_id }) {
        const campaign = this.campaigns.get(campaign_id);
        if (campaign) campaign.status = 'MONITORING';
        console.log(`[Orchestrator] Ads live. Campaign → MONITORING`);
    }

    _onOptimizationApplied({ payload: { actions }, campaign_id }) {
        const campaign = this.campaigns.get(campaign_id);
        if (!campaign) return;
        campaign.loop_count += 1;
        campaign.status = `LOOP_${campaign.loop_count}`;
        console.log(`[Orchestrator] Optimization applied. Loop #${campaign.loop_count}`);
    }

    _onAnomalyDetected({ payload: { severity }, campaign_id }) {
        if (severity === 'CRITICAL' || severity === 'HIGH') {
            const campaign = this.campaigns.get(campaign_id);
            if (campaign) campaign.status = 'PAUSED';
            console.warn(`[Orchestrator] 🚨 Anomaly detected. Campaign → PAUSED`);
        }
    }
}
