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
        this.launchType = 'campaign'; // 'campaign' or 'article'
        this.pipelineMapping = {
            'PLANNING':          ['node-orchestrator', 'node-planner', 'arrow-1', 'arrow-2'],
            'STRATEGY':          ['node-strategy', 'arrow-2'],
            'CONTENT_GEN':       ['node-contentgen', 'arrow-2'],
            'MULTIMODAL':        ['node-multimodal', 'arrow-2'],
            'EXECUTING':         ['node-channelexec', 'arrow-3'],
            'DEPLOYED':          ['node-channelexec', 'arrow-3'],
            'ANALYZING':         ['node-analysis', 'arrow-4'],
            'OPTIMIZING':        ['node-optimizer', 'arrow-5'],
            'COMPLETED':         ['arrow-loop']
        };
    }

    init() {
        i18n.updateUI();
        this._bindButtons();
        this._subscribeToEvents();
        this._startAnimations();
        this.log(i18n.t('status_online'), 'success');
        this._updatePipeline('IDLE'); // Initial state should be idle
    }

    _updatePipeline(status) {
        console.log(`[UI] Updating Neural Pipeline: ${status}`);
        
        // Helper to get all production edges
        const productionEdges = ['edge-2-top', 'edge-2-mid', 'edge-2-bot'];

        const stateMap = {
            'IDLE': { nodes: [], edges: [] },
            'PLANNING': { 
                nodes: ['node-orchestrator', 'node-planner'], 
                edges: ['edge-1'] 
            },
            'STRATEGY': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy'], 
                edges: ['edge-1', ...productionEdges] 
            },
            'CONTENT_GEN': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen'], 
                edges: ['edge-1', ...productionEdges] 
            },
            'MULTIMODAL': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen', 'node-multimodal'], 
                edges: ['edge-1', ...productionEdges] 
            },
            'PENDING_REVIEW': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen', 'node-multimodal', 'node-reviewer'], 
                edges: ['edge-1', ...productionEdges, 'edge-3-top', 'edge-3-mid', 'edge-3-bot'] 
            },
            'PRODUCTION': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen', 'node-multimodal', 'node-reviewer', 'node-channelexec'], 
                edges: ['edge-1', ...productionEdges, 'edge-3-top', 'edge-3-mid', 'edge-3-bot', 'edge-4'] 
            },
            'MONITORING': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen', 'node-multimodal', 'node-reviewer', 'node-channelexec', 'node-analysis'], 
                edges: ['edge-1', ...productionEdges, 'edge-3-top', 'edge-3-mid', 'edge-3-bot', 'edge-4', 'edge-5'] 
            },
            'OPTIMIZING': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen', 'node-multimodal', 'node-reviewer', 'node-channelexec', 'node-analysis'], 
                edges: ['edge-1', ...productionEdges, 'edge-3-top', 'edge-3-mid', 'edge-3-bot', 'edge-4', 'edge-5'] 
            },
            'COMPLETED': { 
                nodes: ['node-orchestrator', 'node-planner', 'node-strategy', 'node-contentgen', 'node-multimodal', 'node-reviewer', 'node-channelexec', 'node-analysis'], 
                edges: ['edge-1', ...productionEdges, 'edge-3-top', 'edge-3-mid', 'edge-3-bot', 'edge-4', 'edge-5'] 
            }
        };

        const current = stateMap[status] || stateMap['IDLE'];

        // 1. Clear all
        document.querySelectorAll('.agent-neuron, .svg-edge').forEach(el => {
            el.classList.remove('active', 'working');
        });
        document.getElementById('edge-retry')?.classList.add('hidden');

        // 2. Set Active nodes and edges
        current.nodes.forEach(id => document.getElementById(id)?.classList.add('active'));
        current.edges.forEach(id => document.getElementById(id)?.classList.add('active'));

        // 3. Set Working (Pulse)
        if (current.nodes.length > 0) {
            const lastNodeId = current.nodes[current.nodes.length - 1];
            document.getElementById(lastNodeId)?.classList.add('working');
        }

        // 4. Handle Rejection Loop
        if (this.lastReviewStatus === 'REJECTED' && status === 'STRATEGY') {
            document.getElementById('edge-retry')?.classList.remove('hidden');
        }
    }

    _updateDynamicForm(type) {
        const urlLabel = document.getElementById('label-url');
        const urlInput = document.getElementById('promo-url-input');
        const locationGroup = document.getElementById('location-group');
        const objectiveSelect = document.getElementById('promo-objective-select');
        
        const configs = {
            'ecom': {
                label: 'Product URL (Amazon/Shopify)',
                placeholder: 'https://amazon.com/dp/B0CX123...',
                showLocation: true,
                defaultObjective: 'conversion'
            },
            'software': {
                label: 'Project/Repo URL (GitHub/AppStore)',
                placeholder: 'https://github.com/user/repo',
                showLocation: false,
                defaultObjective: 'growth'
            },
            'lead': {
                label: 'Landing Page URL',
                placeholder: 'https://your-business.com/demo',
                showLocation: true,
                defaultObjective: 'traffic'
            }
        };

        const config = configs[type];
        urlLabel.textContent = config.label;
        urlInput.placeholder = config.placeholder;
        locationGroup.style.display = config.showLocation ? 'block' : 'none';
        objectiveSelect.value = config.defaultObjective;
        this._updateKpiUnit(config.defaultObjective);
    }

    _updateKpiUnit(objective) {
        const unitEl = document.getElementById('kpi-unit');
        const kpiInput = document.getElementById('promo-kpi-input');
        const units = {
            'growth':     'CPA (Star)',
            'awareness':  'CPM',
            'conversion': 'ROAS',
            'traffic':    'CPC'
        };
        unitEl.textContent = units[objective] || 'Target';
        kpiInput.value = (objective === 'conversion') ? '3.0' : '1.0';
    }

    // ── Event subscriptions → UI updates ────────────────────────

    _subscribeToEvents() {
        // ... (other subscriptions)
        
        globalEventBus.subscribe('StatusChanged', ({ payload: { old_status, new_status }, campaign_id }) => {
            this.log(i18n.t('log_campaign_status_change', { id: campaign_id, old: old_status, new: new_status }), 'info');
            this._updateCampaignBadge(new_status);
            this._updatePipeline(new_status);
        });

        // Store review status for DAG conditional edges
        globalEventBus.subscribe('ReviewCompleted', ({ payload: { status } }) => {
            this.lastReviewStatus = status; 
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

        // Campaign Type Tabs logic
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._updateDynamicForm(btn.dataset.type);
            });
        });

        // AI Analyze URL logic
        document.getElementById('btn-analyze-url')?.addEventListener('click', async () => {
            const urlInput = document.getElementById('promo-url-input');
            const url = urlInput.value.trim();
            const type = document.querySelector('.tab-btn.active')?.dataset.type || 'ecom';

            if (!url || !url.startsWith('http')) {
                alert('Please enter a valid URL first.');
                return;
            }

            this._setAnalyzeLoading(true);
            try {
                const response = await api.analyzeUrl(url, type);
                if (response.success) {
                    this._fillCampaignForm(response.data);
                    this.log('AI Analysis complete: Form updated with product insights!', 'success');
                } else {
                    this.log(`AI Analysis failed: ${response.error}`, 'error');
                }
            } catch (err) {
                this.log(`AI Analysis failed: ${err.message}`, 'error');
            } finally {
                this._setAnalyzeLoading(false);
            }
        });

        // Channel card selection
        document.querySelectorAll('.channel-card').forEach(card => {
            card.addEventListener('click', () => {
                card.classList.toggle('active');
            });
        });

        // Objective change -> update KPI unit
        document.getElementById('promo-objective-select')?.addEventListener('change', (e) => {
            this._updateKpiUnit(e.target.value);
        });

        // Card action buttons
        document.getElementById('btn-gen-new')?.addEventListener('click',   () => this._triggerContentGen());
        document.getElementById('btn-view-library')?.addEventListener('click', () => this._showHistoryModal());
        document.getElementById('btn-view-history')?.addEventListener('click', () => this._showCampaignModal());
        document.getElementById('btn-channels')?.addEventListener('click',     () => this._showComingSoon('Channels Management'));
        document.getElementById('btn-exec')?.addEventListener('click',       () => this._triggerExecution());
        document.getElementById('btn-export-data')?.addEventListener('click',  () => this._showComingSoon('Data Export'));
        document.getElementById('btn-sync')?.addEventListener('click',       () => this._triggerAnalysis());
        document.getElementById('btn-view-rules')?.addEventListener('click',  () => this._showComingSoon('Rule Engine Dashboard'));
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

        // Campaign Modal actions
        document.getElementById('btn-close-campaign-modal')?.addEventListener('click', () => this._closeCampaignModal());
        document.getElementById('btn-close-campaign')?.addEventListener('click', () => this._closeCampaignModal());

        // Language buttons
        document.getElementById('btn-lang-zh')?.addEventListener('click', () => i18n.setLocale('zh'));
        document.getElementById('btn-lang-en')?.addEventListener('click', () => i18n.setLocale('en'));
    }

    // ── Actions ──────────────────────────────────────────────────

    async _launchCampaign() {
        this.launchType = 'campaign';
        document.getElementById('launch-modal').style.display = 'block';
        document.getElementById('promo-goal-input').value = '新品 X Pro 冷启动推广，Q2 GMV 达 500 万';
        document.getElementById('btn-confirm-launch').textContent = '🚀 Launch Full Pipeline';
    }

    async _triggerContentGen() {
        this.launchType = 'article';
        this._updatePipeline('CONTENT_GEN');
        document.getElementById('launch-modal').style.display = 'block';
        document.getElementById('promo-goal-input').value = 'Promote my open source project https://github.com/CadanHu/data-analyse-system on Zhihu';
        document.getElementById('btn-confirm-launch').textContent = '🚀 Start Generation';
    }

    _closeLaunchModal() {
        document.getElementById('launch-modal').style.display = 'none';
    }

    async _showHistoryModal() {
        const historyList = document.getElementById('history-list');
        const modalTitle = document.getElementById('library-modal-title');
        
        // Update Title via i18n
        if (modalTitle) modalTitle.textContent = i18n.t('modal_history_title');
        
        historyList.innerHTML = '<div class="loading">Loading library...</div>';
        document.getElementById('history-modal').style.display = 'block';

        const response = await api.listArticles();
        if (response.success) {
            this._renderHistoryList(response.data.items);
        } else {
            historyList.innerHTML = `<div class="error">Failed to load library: ${response.error}</div>`;
        }
    }

    _closeHistoryModal() {
        document.getElementById('history-modal').style.display = 'none';
    }

    async _showCampaignModal() {
        const campaignList = document.getElementById('campaign-list');
        campaignList.innerHTML = '<div class="loading">Loading campaign history...</div>';
        document.getElementById('campaign-modal').style.display = 'block';

        const response = await api.listCampaigns();
        if (response.success) {
            this._renderCampaignList(response.data.items);
        } else {
            campaignList.innerHTML = `<div class="error">Failed to load history: ${response.error}</div>`;
        }
    }

    _closeCampaignModal() {
        document.getElementById('campaign-modal').style.display = 'none';
    }

    _renderCampaignList(items) {
        const campaignList = document.getElementById('campaign-list');
        if (!items || items.length === 0) {
            campaignList.innerHTML = '<div class="empty">No campaigns found.</div>';
            return;
        }

        campaignList.innerHTML = '';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.style.borderLeft = '4px solid var(--accent)';
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h4 style="margin: 0; color: var(--accent);">${item.id.slice(0,8).toUpperCase()}</h4>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="status-badge status-${item.status.toLowerCase()}">${item.status}</span>
                        <button class="campaign-delete-btn" title="Delete" data-id="${item.id}" style="background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0 4px; font-size: 1.1rem;">✕</button>
                    </div>
                </div>
                <p style="font-size: 0.85rem; margin: 8px 0; color: var(--text-dim); line-height: 1.4;">
                    ${item.goal || 'No goal set'}
                </p>
                <div class="history-meta" style="border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px;">
                    <span>📅 ${new Date(item.created_at).toLocaleDateString()}</span>
                    <span>💰 ${item.budget?.total} ${item.budget?.currency}</span>
                </div>
            `;
            div.onclick = () => {
                this.activeCampaignId = item.id;
                this._updateCampaignBadge(item.status);
                this._closeCampaignModal();
                this.log(`Switched to historical campaign: ${item.id.slice(0,8)}`, 'info');
            };
            div.querySelector('.campaign-delete-btn').onclick = async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete campaign ${item.id.slice(0,8)} and all its data?`)) return;
                const res = await api.deleteCampaign(item.id);
                if (res.success) {
                    div.remove();
                    if (this.activeCampaignId === item.id) {
                        this.activeCampaignId = null;
                        this._updateCampaignBadge('NO CAMPAIGN');
                    }
                    if (campaignList.children.length === 0) {
                        campaignList.innerHTML = '<div class="empty">No campaigns found.</div>';
                    }
                } else {
                    alert('Delete failed: ' + res.error);
                }
            };
            campaignList.appendChild(div);
        });
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
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <h4>${item.title || 'Untitled'}</h4>
                <div class="history-meta">
                    <span>${new Date(item.created_at).toLocaleDateString()}</span>
                    <span class="status-badge status-${item.status}">${item.status}</span>
                    <button class="history-delete-btn" title="Delete" data-id="${item.id}">✕</button>
                </div>
            `;
            div.onclick = () => {
                this._closeHistoryModal();
                this._showArticleModal(item);
            };
            div.querySelector('.history-delete-btn').onclick = async (e) => {
                e.stopPropagation();
                if (!confirm(`Delete "${item.title || 'Untitled'}"?`)) return;
                const res = await api.deleteArticle(item.id);
                if (res.success) {
                    div.remove();
                    if (historyList.children.length === 0) {
                        historyList.innerHTML = '<div class="empty">No history found.</div>';
                    }
                } else {
                    alert('Delete failed: ' + res.error);
                }
            };
            historyList.appendChild(div);
        });
    }

    async _confirmLaunchPromotion() {
        const type      = document.querySelector('.tab-btn.active').dataset.type;
        const url       = document.getElementById('promo-url-input').value.trim();
        const desc      = document.getElementById('promo-goal-input').value.trim();
        const objective = document.getElementById('promo-objective-select').value;
        const budget    = parseInt(document.getElementById('promo-budget-input')?.value || '10000');
        const kpi       = parseFloat(document.getElementById('promo-kpi-input')?.value || '1.0');
        const duration  = parseInt(document.getElementById('promo-duration-input')?.value || '7');
        const location  = document.getElementById('promo-location-select').value;
        const channels  = Array.from(document.querySelectorAll('.channel-card.active')).map(c => c.dataset.channel);

        // --- VALIDATION ---
        if (!url || !url.startsWith('http')) {
            alert('Please enter a valid URL.');
            return;
        }

        this._closeLaunchModal();
        this._setButtonState('btn-launch', 'Launching...', true);
        this._updatePipeline('PLANNING');

        const campaignGoal = `[Type: ${type.toUpperCase()}] Objective: ${objective}. Desc: ${desc}. URL: ${url}. Region: ${location}.`;

        // Map frontend internal objectives to backend-friendly metric names if needed
        const metricMap = {
            'growth':     'CAC',
            'awareness':  'REACH',
            'conversion': 'ROAS',
            'traffic':    'CTR'
        };
        const backendMetric = metricMap[objective] || 'ROAS';

        const response = await api.createCampaign({
            goal:        campaignGoal,
            campaign_type: type,
            budget:      { total: budget, currency: 'CNY' }, // Simplified
            timeline:    { 
                start: new Date().toISOString().split('T')[0], 
                end:   new Date(Date.now() + duration * 86400000).toISOString().split('T')[0],
                duration_days: duration
            },
            kpi:         { metric: backendMetric, target: kpi },
            constraints: { channels: channels, region: location, url: url },
        });

        if (!response.success) {
            // Fix: Show readable error instead of [object Object]
            const errorMsg = typeof response.error === 'object' ? JSON.stringify(response.error) : response.error;
            this.log(`Launch failed: ${errorMsg}`, 'error');
            this._setButtonState('btn-launch', i18n.t('btn_launch'), false);
            return;
        }

        this.activeCampaignId = response.data.id;
        this.log(i18n.t('log_campaign_created', { id: this.activeCampaignId.slice(0, 8) }), 'success');
        this._updateCampaignBadge(response.data.status);

        // Trigger Start
        const startResp = await api.startCampaign(this.activeCampaignId);
        if (startResp.success) {
            this._updateCampaignBadge('PLANNING');
        } else {
            this.log(`Start failed: ${startResp.error}`, 'error');
        }
        this._setButtonState('btn-launch', i18n.t('btn_launch'), false);
    }

    async _runArticleGenWorkflow(goal, channels) {
        this._setButtonState('btn-gen-new', i18n.t('btn_generating'), true);
        this.log('Starting AI technical article generation...', 'info');

        const response = await api.callAgent('content_gen', {
            campaign_id:    this.activeCampaignId || 'demo',
            goal:           goal,
            strategy:       { channel_plan: channels.map(ch => ({ channel: ch })) },
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

    async _runFullPipelineWorkflow(goal, budget, kpi, channels) {
        this._setButtonState('btn-launch', i18n.t('btn_launching'), true);
        this.log(i18n.t('log_campaign_cycle_started'), 'divider');
        this._updatePipeline('PLANNING');

        const response = await api.createCampaign({
            goal:        goal,
            budget:      { total: budget, currency: 'CNY', daily_cap: Math.floor(budget / 10) },
            timeline:    { start: new Date().toISOString().split('T')[0], end: '2026-12-31' },
            kpi:         { metric: 'ROAS', target: kpi },
            constraints: { channels: channels, region: 'CN' },
        });

        if (!response.success) {
            this.log(`Error: ${response.error}`, 'error');
            this._setButtonState('btn-launch', i18n.t('btn_launch'), false);
            return;
        }

        this.activeCampaignId = response.data.id;
        this.log(i18n.t('log_campaign_created', { id: this.activeCampaignId.slice(0, 8) }), 'success');
        this._updateCampaignBadge(response.data.status);

        // Subscribe to WS
        wsBroadcaster.subscribe(this.activeCampaignId, (msg) => {
            console.log('[WS →]', msg.type, msg.payload);
            this._handleWsMessage(msg);
        });

        // Trigger Start
        const startResp = await api.startCampaign(this.activeCampaignId);
        if (startResp.success) {
            this._updateCampaignBadge('PLANNING');
            this.log(i18n.t('log_pipeline_started', { id: startResp.data.job_id?.slice(0, 8) }), 'info');
        } else {
            this.log(`Start failed: ${startResp.error}`, 'error');
        }
        this._setButtonState('btn-launch', i18n.t('btn_launch'), false);
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
        this._updatePipeline('EXECUTING');
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
        this._updatePipeline('ANALYZING');
        this._setButtonState('btn-sync', i18n.t('btn_syncing'), true);
        const agent = new AnalysisAgent();
        await agent.run({ metrics: ['CTR', 'ROAS'], campaign_id: this.activeCampaignId || 'demo' });
        this._setButtonState('btn-sync', i18n.t('btn_sync_analytics'), false);
    }

    async _triggerOptimizer() {
        this._updatePipeline('OPTIMIZING');
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
                this._updatePipeline(payload.new_status);
                break;
            case 'campaign.plan_ready':
                this.log(i18n.t('log_planner_dag', { n: payload.plan?.tasks?.length ?? '?', s: payload.plan?.scenario }), 'info');
                this._updateStat('gen-count', `${payload.plan?.tasks?.length ?? '?'} Tasks`);
                this._updatePipeline('PLANNING');
                break;
            case 'task.content_generated':
                this.log(i18n.t('log_content_gen', { n: payload.bundle?.variants?.length ?? 0 }), 'success');
                this._updateStat('gen-count', `${payload.bundle?.variants?.length ?? 0} Variants`);
                this._updatePipeline('CONTENT_GEN');
                break;
            case 'task.assets_generated':
                this.log(i18n.t('log_assets_gen', { n: payload.asset_ids?.length ?? 0, type: payload.type }), 'success');
                this._updatePipeline('MULTIMODAL');
                break;
            case 'task.strategy_decided':
                this.log(i18n.t('log_strategy_decided', { channels: payload.strategy?.channel_plan?.map(c => c.channel).join(', ') }), 'info');
                this._updatePipeline('STRATEGY');
                break;
            case 'task.ad_deployed':
                const platforms = payload.platforms?.join(', ');
                this.log(i18n.t('log_ads_deployed', { platforms }), 'success');
                this._addFeedItem(i18n.t('log_deployed_to', { platforms: payload.platforms?.join(' & ') }));
                this._updateStat('exec-reach', '87.4%');
                this._updatePipeline('DEPLOYED');
                break;
            case 'metrics.updated':
                this.log(i18n.t('log_analytics_report', { roas: payload.metrics?.roas?.toFixed(2), ctr: ((payload.metrics?.ctr ?? 0) * 100).toFixed(2) }), 'info');
                this._updateStat('roi-value', `+${((payload.metrics?.roas - 1) * 100)?.toFixed(1)}%`);
                this._animateChartBars(payload.metrics?.roas);
                this._updatePipeline('ANALYZING');
                break;
            case 'optimization.applied':
                const types = payload.actions?.map(a => a.type).join(', ') || 'NONE';
                this.log(i18n.t('log_optimizer_fired', { types }), 'warning');
                this._updateOptStatus(i18n.t('log_opt_status', { loop: payload.loop_count, types }));
                this._updatePipeline('OPTIMIZING');
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

    _setAnalyzeLoading(loading) {
        const btn = document.getElementById('btn-analyze-url');
        const icon = document.getElementById('analyze-icon');
        if (btn) {
            btn.disabled = loading;
            btn.style.opacity = loading ? '0.7' : '1';
            if (icon) icon.textContent = loading ? '⏳' : '✨';
        }
    }

    _fillCampaignForm(data) {
        if (!data) return;
        
        // Product Identity
        const descInput = document.getElementById('promo-goal-input');
        if (descInput) {
            const productPart = data.product_name ? `${data.product_name}: ` : "";
            const descPart = data.description || "";
            let uspsPart = "";
            if (Array.isArray(data.core_usps) && data.core_usps.length > 0) {
                uspsPart = `\n\nUSPs:\n- ${data.core_usps.join('\n- ')}`;
            }
            descInput.value = `${productPart}${descPart}${uspsPart}`;
        }

        // Objective mapping
        const objectiveSelect = document.getElementById('promo-objective-select');
        const objectiveMap = {
            'brand_awareness':  'awareness',
            'user_growth':      'growth',
            'sales_conversion': 'conversion',
            'website_traffic':  'traffic'
        };
        const mappedObj = objectiveMap[data.campaign_goal_suggested];
        if (mappedObj && objectiveSelect) {
            objectiveSelect.value = mappedObj;
            this._updateKpiUnit(mappedObj);
        }
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

    _showComingSoon(feature) {
        this.log(`Feature [${feature}] is coming soon in v0.1.0!`, 'info');
        alert(`${feature} is currently under development and will be available in the next update.`);
    }
}

// ── Bootstrap ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new DashboardController();
    dashboard.init();
});
