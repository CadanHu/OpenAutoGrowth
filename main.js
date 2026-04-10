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

// ── i18n ──────────────────────────────────────────────────────────
import { i18n }                  from './src/i18n/index.js';

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
        i18n.updateUI();
        this._bindButtons();
        this._subscribeToEvents();
        this._startAnimations();
        this.log(i18n.t('status_online'), 'success');
    }

    // ── Event subscriptions → UI updates ────────────────────────

    _subscribeToEvents() {
        // Handle language changes
        document.addEventListener('languageChanged', () => {
            this._updateCampaignBadge(document.getElementById('campaign-status-badge').textContent);
        });

        // Campaign 状态变化 → 状态标签更新
        globalEventBus.subscribe('StatusChanged', ({ payload: { old_status, new_status }, campaign_id }) => {
            this.log(i18n.t('log_campaign_status_change', { id: campaign_id, old: old_status, new: new_status }), 'info');
            this._updateCampaignBadge(new_status);
        });

        globalEventBus.subscribe('PlanGenerated', ({ payload: { plan } }) => {
            this.log(i18n.t('log_planner_dag', { n: plan.tasks.length, s: plan.scenario }), 'info');
            this._updateStat('gen-count', `${plan.tasks.length} Tasks`);
        });

        globalEventBus.subscribe('ContentGenerated', ({ payload: { bundle } }) => {
            const count = bundle.variants?.length || 0;
            this.log(i18n.t('log_content_gen', { n: count }), 'success');
            this._updateStat('gen-count', `${count} Variants`);
        });

        globalEventBus.subscribe('AssetsGenerated', ({ payload: { asset_ids, type } }) => {
            this.log(i18n.t('log_assets_gen', { n: asset_ids.length, type }), 'success');
        });

        globalEventBus.subscribe('StrategyDecided', ({ payload: { strategy } }) => {
            const channels = strategy.channel_plan?.map(c => c.channel).join(', ');
            this.log(i18n.t('log_strategy_decided', { channels }), 'info');
        });

        globalEventBus.subscribe('AdDeployed', ({ payload, campaign_id }) => {
            const platforms = payload.platforms?.join(', ');
            this.log(i18n.t('log_ads_deployed', { platforms }), 'success');
            this._addFeedItem(i18n.t('log_deployed_to', { platforms: payload.platforms?.join(' & ') }));
            this._updateStat('exec-reach', '87.4%');
        });

        globalEventBus.subscribe('ReportGenerated', ({ payload }) => {
            const { roas, ctr } = payload.metrics || {};
            this.log(i18n.t('log_analytics_report', { roas: roas?.toFixed(2), ctr: (ctr * 100)?.toFixed(2) }), 'info');
            this._updateStat('roi-value', `+${((roas - 1) * 100)?.toFixed(1)}%`);
            this._animateChartBars(roas);
        });

        globalEventBus.subscribe('OptimizationApplied', ({ payload }) => {
            const types = payload.actions?.map(a => a.type).join(', ') || 'NONE';
            this.log(i18n.t('log_optimizer_fired', { types }), 'warning');
            this._updateOptStatus(i18n.t('log_opt_status', { loop: payload.loop_count, types }));
        });

        globalEventBus.subscribe('AnomalyDetected', ({ payload }) => {
            this.log(i18n.t('log_anomaly_detected', { metric: payload.metric, channel: payload.channel, severity: payload.severity }), 'error');
        });
    }

    // ── Button bindings ──────────────────────────────────────────

    _bindButtons() {
        // Main launch button
        document.getElementById('btn-launch')?.addEventListener('click', () => this._launchCampaign());

        // Card action buttons
        document.getElementById('btn-gen-new')?.addEventListener('click',   () => this._triggerContentGen());
        document.getElementById('btn-view-history')?.addEventListener('click', () => this._showHistoryModal());
        document.getElementById('btn-exec')?.addEventListener('click',       () => this._triggerExecution());
        document.getElementById('btn-sync')?.addEventListener('click',       () => this._triggerAnalysis());
        document.getElementById('btn-optimize')?.addEventListener('click',   () => this._triggerOptimizer());

        // Article Modal actions
        document.getElementById('btn-close-modal')?.addEventListener('click', () => this._closeArticleModal());
        document.getElementById('btn-cancel-article')?.addEventListener('click', () => this._closeArticleModal());
        document.getElementById('btn-publish-article')?.addEventListener('click', () => this._publishArticle());

        // Launch Modal actions
        document.getElementById('btn-close-launch-modal')?.addEventListener('click', () => this._closeLaunchModal());
        document.getElementById('btn-cancel-launch')?.addEventListener('click', () => this._closeLaunchModal());
        document.getElementById('btn-confirm-launch')?.addEventListener('click', () => this._confirmLaunchPromotion());

        // History Modal actions
        document.getElementById('btn-close-history-modal')?.addEventListener('click', () => this._closeHistoryModal());
        document.getElementById('btn-close-history')?.addEventListener('click', () => this._closeHistoryModal());

        // Language buttons
        document.getElementById('btn-lang-zh')?.addEventListener('click', () => i18n.setLocale('zh'));
        document.getElementById('btn-lang-en')?.addEventListener('click', () => i18n.setLocale('en'));
    }

    // ── Actions ──────────────────────────────────────────────────

    async _launchCampaign() {
        this._setButtonState('btn-launch', i18n.t('btn_launching'), true);
        this.log(i18n.t('log_campaign_cycle_started'), 'divider');

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
        this.log(i18n.t('log_campaign_created', { id: this.activeCampaignId.slice(0, 8) }), 'success');
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
            this.log(i18n.t('log_pipeline_started', { id: startResp.data.job_id?.slice(0, 8) }), 'info');
        } else {
            this.log(`Start failed: ${startResp.error}`, 'error');
        }
        this._setButtonState('btn-launch', i18n.t('btn_launch'), false);
    }

    async _triggerContentGen() {
        // Now opens a modal for user input first
        document.getElementById('launch-modal').style.display = 'block';
        document.getElementById('promo-goal-input').value = 'Promote my open source project https://github.com/CadanHu/data-analyse-system on Zhihu';
    }

    _closeLaunchModal() {
        document.getElementById('launch-modal').style.display = 'none';
    }

    async _showHistoryModal() {
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = '<div class="loading">Loading history...</div>';
        document.getElementById('history-modal').style.display = 'block';

        const response = await api.listArticles();
        if (response.success) {
            this._renderHistoryList(response.data.items);
        } else {
            historyList.innerHTML = `<div class="error">Failed to load history: ${response.error}</div>`;
        }
    }

    _renderHistoryList(items) {
        const historyList = document.getElementById('history-list');
        if (!items || items.length === 0) {
            historyList.innerHTML = '<div class="empty">No history found.</div>';
            return;
        }

        historyList.innerHTML = '';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <h4>${item.title || 'Untitled'}</h4>
                <div class="history-meta">
                    <span>${new Date(item.created_at).toLocaleDateString()}</span>
                    <span class="status-badge status-${item.status}">${item.status}</span>
                </div>
            `;
            div.onclick = () => {
                this._closeHistoryModal();
                this._showArticleModal(item);
            };
            historyList.appendChild(div);
        });
    }

    _closeHistoryModal() {
        document.getElementById('history-modal').style.display = 'none';
    }

    async _confirmLaunchPromotion() {
        const goal = document.getElementById('promo-goal-input').value;
        const selectedChannels = Array.from(document.querySelectorAll('input[name="channel"]:checked')).map(cb => cb.value);

        if (!goal || selectedChannels.length === 0) {
            alert('Please provide a goal and at least one channel.');
            return;
        }

        this._closeLaunchModal();
        this._setButtonState('btn-gen-new', i18n.t('btn_generating'), true);
        this.log('Starting AI technical article generation...', 'info');

        // Use the Python backend via the callAgent API
        const response = await api.callAgent('content_gen', {
            campaign_id:    this.activeCampaignId || 'demo',
            goal:           goal,
            strategy:       { channel_plan: selectedChannels.map(ch => ({ channel: ch })) },
            kpi:            { metric: 'awareness', target: 'high' }
        });

        if (response.success) {
            const output = response.data;
            if (output.content?.variants?.[0]?.body) {
                this._showArticleModal(output.content.variants[0]);
            }
        } else {
            this.log(`Content generation failed: ${response.error}`, 'error');
        }

        this._setButtonState('btn-gen-new', i18n.t('btn_gen_new'), false);
    }

    _showArticleModal(variant) {
        document.getElementById('article-title-input').value = variant.title || 'Untitled Article';
        document.getElementById('article-body-input').value = variant.body || '';
        document.getElementById('article-modal').style.display = 'block';
    }

    _closeArticleModal() {
        document.getElementById('article-modal').style.display = 'none';
    }

    async _publishArticle() {
        this._closeArticleModal();
        this.log('Publishing article to Zhihu...', 'info');

        const title = document.getElementById('article-title-input').value;
        const body = document.getElementById('article-body-input').value;

        // Trigger execution agent for Zhihu via Python backend
        // We don't await polling here to keep UI responsive as requested
        api.callAgent('channel_exec', {
            campaign_id: this.activeCampaignId || 'demo',
            strategy: { channel_plan: [{ channel: 'zhihu' }] },
            content: { variants: [{ title, body, channel: 'zhihu' }] }
        }).then(response => {
            if (response.success) {
                this.log('Article successfully published to Zhihu!', 'success');
            } else {
                this.log(`Publishing failed: ${response.error}`, 'error');
            }
        });

        this.log('Article queued for publishing to Zhihu', 'success');
    }

    async _triggerExecution() {
        this._setButtonState('btn-exec', i18n.t('btn_executing'), true);
        const agent = new ChannelExecAgent();
        await agent.run({
            campaign_id: this.activeCampaignId || 'demo',
            context: {
                t1: { channel_plan: [{ channel: 'tiktok', budget: 20000 }, { channel: 'meta', budget: 15000 }] },
                t2: { variants: [{ id: 'copy_vA', hook: '效率翻倍' }] },
                t3: { assets: [{ id: 'img_001', type: 'IMAGE' }] },
            },
        });
        this._setButtonState('btn-exec', i18n.t('btn_exec_batch'), false);
    }

    async _triggerAnalysis() {
        this._setButtonState('btn-sync', i18n.t('btn_syncing'), true);
        const agent = new AnalysisAgent();
        await agent.run({ metrics: ['CTR', 'ROAS'], campaign_id: this.activeCampaignId || 'demo' });
        this._setButtonState('btn-sync', i18n.t('btn_sync_analytics'), false);
    }

    async _triggerOptimizer() {
        this._setButtonState('btn-optimize', i18n.t('btn_optimizing'), true);
        const analysisAgent = new AnalysisAgent();
        const report = await analysisAgent.run({ metrics: ['CTR', 'ROAS'], campaign_id: this.activeCampaignId || 'demo' });
        const optimizerAgent = new OptimizerAgent();
        await optimizerAgent._optimize(report, this.activeCampaignId || 'demo');
        this._setButtonState('btn-optimize', i18n.t('btn_run_optimizer'), false);
    }

    // ── WebSocket message router ─────────────────────────────────

    _handleWsMessage(msg) {
        const { type, payload, campaign_id } = msg;
        switch (type) {
            case 'campaign.status_changed':
                this.log(i18n.t('log_campaign_status_change', { id: campaign_id?.slice(0,8), old: payload.old_status, new: payload.new_status }), 'info');
                this._updateCampaignBadge(payload.new_status);
                break;
            case 'campaign.plan_ready':
                this.log(i18n.t('log_planner_dag', { n: payload.plan?.tasks?.length ?? '?', s: payload.plan?.scenario }), 'info');
                this._updateStat('gen-count', `${payload.plan?.tasks?.length ?? '?'} Tasks`);
                break;
            case 'task.content_generated':
                this.log(i18n.t('log_content_gen', { n: payload.bundle?.variants?.length ?? 0 }), 'success');
                this._updateStat('gen-count', `${payload.bundle?.variants?.length ?? 0} Variants`);
                break;
            case 'task.assets_generated':
                this.log(i18n.t('log_assets_gen', { n: payload.asset_ids?.length ?? 0, type: payload.type }), 'success');
                break;
            case 'task.strategy_decided':
                this.log(i18n.t('log_strategy_decided', { channels: payload.strategy?.channel_plan?.map(c => c.channel).join(', ') }), 'info');
                break;
            case 'task.ad_deployed':
                const platforms = payload.platforms?.join(', ');
                this.log(i18n.t('log_ads_deployed', { platforms }), 'success');
                this._addFeedItem(i18n.t('log_deployed_to', { platforms: payload.platforms?.join(' & ') }));
                this._updateStat('exec-reach', '87.4%');
                break;
            case 'metrics.updated':
                this.log(i18n.t('log_analytics_report', { roas: payload.metrics?.roas?.toFixed(2), ctr: ((payload.metrics?.ctr ?? 0) * 100).toFixed(2) }), 'info');
                this._updateStat('roi-value', `+${((payload.metrics?.roas - 1) * 100)?.toFixed(1)}%`);
                this._animateChartBars(payload.metrics?.roas);
                break;
            case 'optimization.applied':
                const types = payload.actions?.map(a => a.type).join(', ') || 'NONE';
                this.log(i18n.t('log_optimizer_fired', { types }), 'warning');
                this._updateOptStatus(i18n.t('log_opt_status', { loop: payload.loop_count, types }));
                break;
            case 'anomaly.detected':
                this.log(i18n.t('log_anomaly_detected', { metric: payload.metric, channel: payload.channel, severity: payload.severity }), 'error');
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
        if (badge) {
            // If the status is one of our predefined states that should be translated
            const translationKey = `status_${status.toLowerCase()}`;
            if (i18n.t(translationKey) !== translationKey) {
                badge.setAttribute('data-i18n', translationKey);
                badge.innerHTML = i18n.t(translationKey);
            } else {
                badge.removeAttribute('data-i18n');
                badge.textContent = status;
            }
        }
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
