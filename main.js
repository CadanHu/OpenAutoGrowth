/**
 * OpenAutoGrowth — Main Entry Point
 * 完整集成：Multi-Agent 闭环系统 + REST API + WebSocket 实时推送 + Dashboard UI
 */

// ── Core Support Layer ────────────────────────────────────────────
import { Memory, ToolRegistry }  from './src/core/Memory.js';
import { globalEventBus }        from './src/core/EventBus.js';
import { RuleEngine }            from './src/core/RuleEngine.js';

// ── Intelligence Layer ────────────────────────────────────────────
import { Orchestrator }          from './src/agents/Orchestrator.js';
import { Planner }               from './src/agents/Planner.js';

// ── Execution Agents ─────────────────────────────────────────────
import { ContentGenAgent }       from './src/agents/ContentGen.js';
import { MultimodalAgent }       from './src/agents/Multimodal.js';
import { StrategyAgent }         from './src/agents/Strategy.js';
import { ChannelExecAgent }      from './src/agents/ChannelExec.js';

// ── Feedback Agents ───────────────────────────────────────────────
import { AnalysisAgent }         from './src/agents/Analysis.js';
import { OptimizerAgent }        from './src/agents/Optimizer.js';

// ── API Layer ─────────────────────────────────────────────────────
import { CampaignAPI }           from './src/api/routes.js';
import { wsBroadcaster }         from './src/api/websocket.js';

// ── CSS ───────────────────────────────────────────────────────────
import './style.css';

// ══════════════════════════════════════════════════════════════════
// SYSTEM BOOTSTRAP
// ══════════════════════════════════════════════════════════════════

// 1. 支撑层
const memory       = new Memory();
const toolRegistry = new ToolRegistry();
const ruleEngine   = new RuleEngine();

// 2. 规划层
const planner      = new Planner();
const orchestrator = new Orchestrator({ planner, memory, ruleEngine });

// 3. 注册所有执行 Agent
orchestrator.registerAgent('Strategy',    new StrategyAgent());
orchestrator.registerAgent('ContentGen',  new ContentGenAgent());
orchestrator.registerAgent('Multimodal',  new MultimodalAgent());
orchestrator.registerAgent('ChannelExec', new ChannelExecAgent());
orchestrator.registerAgent('Analysis',    new AnalysisAgent());
orchestrator.registerAgent('Optimizer',   new OptimizerAgent());

// 4. API 层
const api = new CampaignAPI({ orchestrator, memory });

// 5. WebSocket 广播器（已在 import 时自动连接 EventBus）
console.log('[System] WS Broadcaster active.');

console.log('🚀 OpenAutoGrowth System Initialized — All Agents Online');

// ══════════════════════════════════════════════════════════════════
// DASHBOARD UI CONTROLLER
// ══════════════════════════════════════════════════════════════════

class DashboardController {
    constructor() {
        this.activeCampaignId = null;
        this.logLines = 0;
    }

    init() {
        this._bindButtons();
        this._subscribeToEvents();
        this._startAnimations();
        this.log('System online. All 8 agents registered.', 'success');
    }

    // ── Event subscriptions → UI updates ────────────────────────

    _subscribeToEvents() {
        // Campaign 状态变化 → 状态标签更新
        globalEventBus.subscribe('StatusChanged', ({ payload: { old_status, new_status }, campaign_id }) => {
            this.log(`Campaign ${campaign_id}: ${old_status} → <strong>${new_status}</strong>`, 'info');
            this._updateCampaignBadge(new_status);
        });

        globalEventBus.subscribe('PlanGenerated', ({ payload: { plan } }) => {
            this.log(`Planner generated DAG with ${plan.tasks.length} tasks (scenario: ${plan.scenario})`, 'info');
            this._updateStat('gen-count', `${plan.tasks.length} Tasks`);
        });

        globalEventBus.subscribe('ContentGenerated', ({ payload: { bundle } }) => {
            const count = bundle.variants?.length || 0;
            this.log(`ContentGen produced ${count} A/B variants`, 'success');
            this._updateStat('gen-count', `${count} Variants`);
        });

        globalEventBus.subscribe('AssetsGenerated', ({ payload: { asset_ids, type } }) => {
            this.log(`Multimodal generated ${asset_ids.length} ${type}(s)`, 'success');
        });

        globalEventBus.subscribe('StrategyDecided', ({ payload: { strategy } }) => {
            const channels = strategy.channel_plan?.map(c => c.channel).join(', ');
            this.log(`Strategy: distributing budget across ${channels}`, 'info');
        });

        globalEventBus.subscribe('AdDeployed', ({ payload, campaign_id }) => {
            this.log(`Ads deployed to ${payload.platforms?.join(', ')} ✅`, 'success');
            this._addFeedItem(`✓ Deployed to ${payload.platforms?.join(' & ')}`);
            this._updateStat('exec-reach', '87.4%');
        });

        globalEventBus.subscribe('ReportGenerated', ({ payload }) => {
            const { roas, ctr } = payload.metrics || {};
            this.log(`Analytics: ROAS ${roas?.toFixed(2)}x | CTR ${(ctr * 100)?.toFixed(2)}%`, 'info');
            this._updateStat('roi-value', `+${((roas - 1) * 100)?.toFixed(1)}%`);
            this._animateChartBars(roas);
        });

        globalEventBus.subscribe('OptimizationApplied', ({ payload }) => {
            const types = payload.actions?.map(a => a.type).join(', ') || 'NONE';
            this.log(`Optimizer fired: ${types}`, 'warning');
            this._updateOptStatus(`Loop #${payload.loop_count} — ${types}`);
        });

        globalEventBus.subscribe('AnomalyDetected', ({ payload }) => {
            this.log(`⚠️ Anomaly: ${payload.metric} on ${payload.channel} (${payload.severity})`, 'error');
        });
    }

    // ── Button bindings ──────────────────────────────────────────

    _bindButtons() {
        // Main launch button
        document.getElementById('btn-launch')?.addEventListener('click', () => this._launchCampaign());

        // Card action buttons
        document.getElementById('btn-gen-new')?.addEventListener('click',   () => this._triggerContentGen());
        document.getElementById('btn-exec')?.addEventListener('click',       () => this._triggerExecution());
        document.getElementById('btn-sync')?.addEventListener('click',       () => this._triggerAnalysis());
        document.getElementById('btn-optimize')?.addEventListener('click',   () => this._triggerOptimizer());
    }

    // ── Actions ──────────────────────────────────────────────────

    async _launchCampaign() {
        this._setButtonState('btn-launch', 'Launching...', true);
        this.log('─── New Campaign Cycle Started ───', 'divider');

        const response = await api.createCampaign({
            goal:        '新品 X Pro 冷启动推广，Q2 GMV 达 500 万',
            budget:      { total: 50000, currency: 'CNY', daily_cap: 5000 },
            timeline:    { start: '2026-04-10', end: '2026-04-30' },
            kpi:         { metric: 'ROAS', target: 3.0 },
            constraints: { channels: ['tiktok', 'meta', 'google'], region: 'CN' },
        });

        if (!response.success) {
            this.log(`Error: ${response.error}`, 'error');
            this._setButtonState('btn-launch', 'Launch Campaign', false);
            return;
        }

        this.activeCampaignId = response.data.id;
        this.log(`Campaign created: ${this.activeCampaignId.slice(0, 8)}…`, 'success');
        this._updateCampaignBadge(response.data.status);

        // 订阅后端 WebSocket 推送 → 驱动 UI
        wsBroadcaster.subscribe(this.activeCampaignId, (msg) => {
            console.log('[WS →]', msg.type, msg.payload);
            this._handleWsMessage(msg);
        });

        // 触发规划启动
        const startResp = await api.startCampaign(this.activeCampaignId);
        if (startResp.success) {
            this._updateCampaignBadge('PLANNING');
            this.log(`Pipeline started — job ${startResp.data.job_id?.slice(0, 8)}…`, 'info');
        } else {
            this.log(`Start failed: ${startResp.error}`, 'error');
        }
        this._setButtonState('btn-launch', 'Launch Campaign', false);
    }

    async _triggerContentGen() {
        this._setButtonState('btn-gen-new', 'Generating...', true);
        const agent = new ContentGenAgent();
        await agent.run({
            product:        { name: 'X Pro', category: 'SaaS', USP: ['AI驱动', '一键部署', '成本降低60%'] },
            target_persona: { age: '25-35', interest: ['创业', '效率工具'] },
            channels:       ['tiktok', 'weibo'],
            tone:           'energetic',
            ab_variants:    3,
            campaign_id:    this.activeCampaignId || 'demo',
        });
        this._setButtonState('btn-gen-new', 'Generate New', false);
    }

    async _triggerExecution() {
        this._setButtonState('btn-exec', 'Executing...', true);
        const agent = new ChannelExecAgent();
        await agent.run({
            campaign_id: this.activeCampaignId || 'demo',
            context: {
                t1: { channel_plan: [{ channel: 'tiktok', budget: 20000 }, { channel: 'meta', budget: 15000 }] },
                t2: { variants: [{ id: 'copy_vA', hook: '效率翻倍' }] },
                t3: { assets: [{ id: 'img_001', type: 'IMAGE' }] },
            },
        });
        this._setButtonState('btn-exec', 'Execute Batch', false);
    }

    async _triggerAnalysis() {
        this._setButtonState('btn-sync', 'Syncing...', true);
        const agent = new AnalysisAgent();
        await agent.run({ metrics: ['CTR', 'ROAS'], campaign_id: this.activeCampaignId || 'demo' });
        this._setButtonState('btn-sync', 'Sync Analytics', false);
    }

    async _triggerOptimizer() {
        this._setButtonState('btn-optimize', 'Optimizing...', true);
        const analysisAgent = new AnalysisAgent();
        const report = await analysisAgent.run({ metrics: ['CTR', 'ROAS'], campaign_id: this.activeCampaignId || 'demo' });
        const optimizerAgent = new OptimizerAgent();
        await optimizerAgent._optimize(report, this.activeCampaignId || 'demo');
        this._setButtonState('btn-optimize', 'Run Optimizer', false);
    }

    // ── WebSocket message router ─────────────────────────────────

    _handleWsMessage(msg) {
        const { type, payload, campaign_id } = msg;
        switch (type) {
            case 'campaign.status_changed':
                this.log(`Campaign ${campaign_id?.slice(0,8)}: ${payload.old_status} → <strong>${payload.new_status}</strong>`, 'info');
                this._updateCampaignBadge(payload.new_status);
                break;
            case 'campaign.plan_ready':
                this.log(`Planner generated DAG with ${payload.plan?.tasks?.length ?? '?'} tasks (scenario: ${payload.plan?.scenario})`, 'info');
                this._updateStat('gen-count', `${payload.plan?.tasks?.length ?? '?'} Tasks`);
                break;
            case 'task.content_generated':
                this.log(`ContentGen produced ${payload.bundle?.variants?.length ?? 0} A/B variants`, 'success');
                this._updateStat('gen-count', `${payload.bundle?.variants?.length ?? 0} Variants`);
                break;
            case 'task.assets_generated':
                this.log(`Multimodal generated ${payload.asset_ids?.length ?? 0} ${payload.type}(s)`, 'success');
                break;
            case 'task.strategy_decided':
                this.log(`Strategy: distributing budget across ${payload.strategy?.channel_plan?.map(c => c.channel).join(', ')}`, 'info');
                break;
            case 'task.ad_deployed':
                this.log(`Ads deployed to ${payload.platforms?.join(', ')} ✅`, 'success');
                this._addFeedItem(`✓ Deployed to ${payload.platforms?.join(' & ')}`);
                this._updateStat('exec-reach', '87.4%');
                break;
            case 'metrics.updated':
                this.log(`Analytics: ROAS ${payload.metrics?.roas?.toFixed(2)}x | CTR ${((payload.metrics?.ctr ?? 0) * 100).toFixed(2)}%`, 'info');
                this._updateStat('roi-value', `+${((payload.metrics?.roas - 1) * 100)?.toFixed(1)}%`);
                this._animateChartBars(payload.metrics?.roas);
                break;
            case 'optimization.applied':
                this.log(`Optimizer fired: ${payload.actions?.map(a => a.type).join(', ') || 'NONE'}`, 'warning');
                this._updateOptStatus(`Loop #${payload.loop_count} — ${payload.actions?.map(a => a.type).join(', ')}`);
                break;
            case 'anomaly.detected':
                this.log(`⚠️ Anomaly: ${payload.metric} on ${payload.channel} (${payload.severity})`, 'error');
                break;
            default:
                this.log(`[WS] ${type}`, 'info');
        }
    }

    // ── UI Helpers ───────────────────────────────────────────────

    log(message, type = 'info') {
        const logEl = document.getElementById('activity-log');
        if (!logEl) return;

        const colorMap = {
            success: '#10b981', info: '#94a3b8',
            warning: '#f59e0b', error: '#ef4444',
            divider: '#6366f1',
        };

        const line = document.createElement('div');
        line.className = 'log-entry';
        line.style.color = colorMap[type] || '#94a3b8';
        line.style.borderLeft = `2px solid ${colorMap[type]}`;
        line.style.paddingLeft = '8px';
        line.style.marginBottom = '4px';
        line.style.fontSize = '0.8rem';
        line.innerHTML = `<span style="opacity:0.5">${new Date().toLocaleTimeString('zh-CN')}</span> ${message}`;

        logEl.prepend(line);
        if (++this.logLines > 30) logEl.lastChild?.remove();
    }

    _updateStat(id, value) {
        const el = document.getElementById(id);
        if (el) { el.style.opacity = '0'; setTimeout(() => { el.textContent = value; el.style.opacity = '1'; }, 200); }
    }

    _updateCampaignBadge(status) {
        const badge = document.getElementById('campaign-status-badge');
        if (badge) badge.textContent = status;
    }

    _updateOptStatus(text) {
        const el = document.getElementById('opt-status-text');
        if (el) el.textContent = text;
    }

    _addFeedItem(text) {
        const feed = document.getElementById('exec-feed');
        if (!feed) return;
        const item = document.createElement('div');
        item.className = 'feed-item';
        item.textContent = text;
        feed.prepend(item);
        if (feed.children.length > 5) feed.lastChild?.remove();
    }

    _setButtonState(id, text, disabled) {
        const btn = document.getElementById(id);
        if (btn) { btn.textContent = text; btn.disabled = disabled; btn.style.opacity = disabled ? '0.6' : '1'; }
    }

    _animateChartBars(roas = 2.5) {
        const bars = document.querySelectorAll('.bar');
        const heights = [
            `${Math.min(roas * 20, 90)}%`,
            `${Math.min(roas * 25, 95)}%`,
            `${Math.min(roas * 15, 80)}%`,
            `${Math.min(roas * 22, 92)}%`,
        ];
        bars.forEach((b, i) => { b.style.height = heights[i] || '60%'; });
    }

    _startAnimations() {
        // 随机数字波动，模拟实时数据
        setInterval(() => {
            const reach = (85 + Math.random() * 8).toFixed(1);
            const el = document.getElementById('exec-reach');
            if (el && el.textContent.includes('%')) el.textContent = `${reach}%`;
        }, 4000);
    }
}

// ── Bootstrap ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new DashboardController();
    dashboard.init();
});
