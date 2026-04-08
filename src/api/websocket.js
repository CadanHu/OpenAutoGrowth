/**
 * WebSocket Layer — 实时状态推送
 * 订阅 EventBus，将关键事件推送到已连接的 Dashboard 客户端
 * 生产环境：对接 ws / socket.io；当前为浏览器端 EventSource 模拟层
 */
import { globalEventBus } from '../core/EventBus.js';

/**
 * 事件类型 → 前端 UI Action 映射
 * 每个 WS 消息结构：{ type, campaign_id, payload, timestamp }
 */
const WS_EVENT_MAP = {
    'StatusChanged':         'campaign.status_changed',
    'CampaignCreated':       'campaign.created',
    'PlanGenerated':         'campaign.plan_ready',
    'CampaignApproved':      'campaign.approved',
    'CampaignPaused':        'campaign.paused',
    'CampaignCompleted':     'campaign.completed',
    'ContentGenerated':      'task.content_generated',
    'AssetsGenerated':       'task.assets_generated',
    'StrategyDecided':       'task.strategy_decided',
    'AdDeployed':            'task.ad_deployed',
    'ReportGenerated':       'metrics.updated',
    'AnomalyDetected':       'anomaly.detected',
    'OptimizationApplied':   'optimization.applied',
};

export class WSBroadcaster {
    constructor() {
        // Map<campaignId, Set<listenerCallback>>
        this.clients = new Map();
        this._subscribeToEventBus();
    }

    /**
     * 客户端订阅某个 Campaign 的实时更新
     * @param {string}   campaignId
     * @param {Function} callback  - (message) => void
     * @returns {Function} unsubscribe
     */
    subscribe(campaignId, callback) {
        if (!this.clients.has(campaignId)) {
            this.clients.set(campaignId, new Set());
        }
        this.clients.get(campaignId).add(callback);
        console.log(`[WS] Client subscribed to campaign: ${campaignId}`);

        return () => {
            this.clients.get(campaignId)?.delete(callback);
            console.log(`[WS] Client unsubscribed from: ${campaignId}`);
        };
    }

    /**
     * 向指定 Campaign 的所有客户端广播消息
     */
    broadcast(campaignId, message) {
        const listeners = this.clients.get(campaignId);
        if (!listeners || listeners.size === 0) return;
        listeners.forEach(cb => cb(message));
    }

    /**
     * 连接 EventBus，将所有关键事件转发给 WS 客户端
     */
    _subscribeToEventBus() {
        Object.entries(WS_EVENT_MAP).forEach(([eventType, wsType]) => {
            globalEventBus.subscribe(eventType, (event) => {
                if (!event.campaign_id) return;

                const message = {
                    type:        wsType,
                    campaign_id: event.campaign_id,
                    payload:     event.payload,
                    timestamp:   event.occurred_at,
                };

                this.broadcast(event.campaign_id, message);
            });
        });

        console.log(`[WS] Broadcaster listening to ${Object.keys(WS_EVENT_MAP).length} event types`);
    }
}

// 全局单例
export const wsBroadcaster = new WSBroadcaster();
