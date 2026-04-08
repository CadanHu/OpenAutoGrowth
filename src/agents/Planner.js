/**
 * Planner Agent — 任务 DAG 生成器
 * 重构版：按 docs/architecture/01-agent-design.md 规范，支持依赖声明与并行组
 */
export class Planner {
    /**
     * @param {object} input
     * @param {string} input.goal       - 自然语言目标
     * @param {object} input.budget     - { total, currency }
     * @param {object} input.kpi        - { metric, target }
     * @param {object} input.constraints - { channels[], region }
     * @param {object} input.history    - 历史相似 Plan（可为 null）
     * @returns {object} plan - { id, tasks[] }
     */
    async createPlan(input) {
        const { goal, budget, kpi, constraints, history } = input;
        console.log(`[Planner] 🗺️ Generating DAG for: "${goal}"`);

        // 判断场景类型，选择 DAG 模板（生产环境替换为 LLM 调用）
        const scenario = this._detectScenario(goal, constraints);
        const template = this._selectTemplate(scenario, history);

        const plan = {
            id:       `plan_${Date.now()}`,
            scenario,
            goal,
            tasks: template.map(t => ({
                ...t,
                params: {
                    ...t.params,
                    // 注入运行时上下文
                    topic:    goal,
                    budget,
                    kpi,
                    channels: constraints?.channels || ['tiktok', 'meta'],
                }
            })),
            created_at: new Date().toISOString(),
        };

        console.log(`[Planner] Plan "${plan.id}" has ${plan.tasks.length} tasks | Scenario: ${scenario}`);
        return plan;
    }

    /**
     * 根据目标关键词推断业务场景
     */
    _detectScenario(goal, constraints) {
        const g = goal.toLowerCase();
        if (g.includes('新品') || g.includes('冷启动') || g.includes('launch')) return 'NEW_PRODUCT';
        if (g.includes('复购') || g.includes('retention'))                       return 'RETENTION';
        if (g.includes('品牌') || g.includes('brand awareness'))                 return 'BRAND_AWARENESS';
        return 'GROWTH_GENERAL';
    }

    /**
     * 选择 DAG 模板
     * 每个场景对应不同的任务结构和依赖关系
     */
    _selectTemplate(scenario, history) {
        const templates = {
            // 新品冷启动：需要完整链路，Strategy 先行
            NEW_PRODUCT: [
                { id: 't1', agentType: 'Strategy',    dependencies: [],          parallel_group: null,  params: { target: 'cold_start' } },
                { id: 't2', agentType: 'ContentGen',  dependencies: ['t1'],      parallel_group: 'gen', params: { ab_variants: 3, tone: 'energetic' } },
                { id: 't3', agentType: 'Multimodal',  dependencies: ['t1'],      parallel_group: 'gen', params: { type: 'image', sizes: ['9:16','1:1'] } },
                { id: 't4', agentType: 'ChannelExec', dependencies: ['t2','t3'], parallel_group: null,  params: { channels: ['tiktok','meta'] } },
                { id: 't5', agentType: 'Analysis',    dependencies: ['t4'],      parallel_group: null,  params: { metrics: ['CTR','ROAS','Conversions'] } },
                { id: 't6', agentType: 'Optimizer',   dependencies: ['t5'],      parallel_group: null,  params: { threshold_roas: 3.0 } },
            ],

            // 复购促活：侧重文案 A/B，轻素材
            RETENTION: [
                { id: 't1', agentType: 'ContentGen',  dependencies: [],          parallel_group: 'gen', params: { ab_variants: 3, tone: 'warm' } },
                { id: 't2', agentType: 'Strategy',    dependencies: [],          parallel_group: 'gen', params: { target: 'lookalike_audience' } },
                { id: 't3', agentType: 'ChannelExec', dependencies: ['t1','t2'], parallel_group: null,  params: {} },
                { id: 't4', agentType: 'Analysis',    dependencies: ['t3'],      parallel_group: null,  params: { metrics: ['CVR','LTV'] } },
                { id: 't5', agentType: 'Optimizer',   dependencies: ['t4'],      parallel_group: null,  params: { threshold_roas: 2.0 } },
            ],

            // 品牌曝光：侧重视觉素材，不追求转化
            BRAND_AWARENESS: [
                { id: 't1', agentType: 'Multimodal',  dependencies: [],          parallel_group: null,  params: { type: 'video', duration: 30 } },
                { id: 't2', agentType: 'ContentGen',  dependencies: ['t1'],      parallel_group: null,  params: { ab_variants: 2, tone: 'professional' } },
                { id: 't3', agentType: 'Strategy',    dependencies: [],          parallel_group: null,  params: { target: 'reach_maximize' } },
                { id: 't4', agentType: 'ChannelExec', dependencies: ['t1','t2','t3'], parallel_group: null, params: {} },
                { id: 't5', agentType: 'Analysis',    dependencies: ['t4'],      parallel_group: null,  params: { metrics: ['Reach','Impressions','BrandLift'] } },
                { id: 't6', agentType: 'Optimizer',   dependencies: ['t5'],      parallel_group: null,  params: {} },
            ],

            // 通用增长模板
            GROWTH_GENERAL: [
                { id: 't1', agentType: 'Strategy',    dependencies: [],          parallel_group: null,  params: {} },
                { id: 't2', agentType: 'ContentGen',  dependencies: ['t1'],      parallel_group: 'gen', params: { ab_variants: 3 } },
                { id: 't3', agentType: 'Multimodal',  dependencies: ['t1'],      parallel_group: 'gen', params: { type: 'image' } },
                { id: 't4', agentType: 'ChannelExec', dependencies: ['t2','t3'], parallel_group: null,  params: {} },
                { id: 't5', agentType: 'Analysis',    dependencies: ['t4'],      parallel_group: null,  params: { metrics: ['CTR','ROAS','ROI'] } },
                { id: 't6', agentType: 'Optimizer',   dependencies: ['t5'],      parallel_group: null,  params: { threshold_roas: 3.0 } },
            ],
        };

        return templates[scenario] || templates['GROWTH_GENERAL'];
    }
}
