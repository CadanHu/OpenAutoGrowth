/**
 * EventBus — 事件总线（基于内存/可扩展至 Redis Streams）
 * OpenAutoGrowth Core Support Layer
 */
export class EventBus {
    constructor() {
        this.subscribers = new Map(); // Map<eventType, Set<handler>>
        this.history = [];
    }

    /**
     * 发布领域事件
     * @param {string} eventType - 事件类型，如 'CampaignCreated'
     * @param {object} payload - 事件数据
     * @param {string} campaignId - 关联的 Campaign ID
     */
    publish(eventType, payload, campaignId = null) {
        const event = {
            id: crypto.randomUUID(),
            event_type: eventType,
            version: '1.0',
            campaign_id: campaignId,
            trace_id: payload.trace_id || crypto.randomUUID(),
            payload,
            occurred_at: new Date().toISOString(),
        };

        console.log(`[EventBus] 📢 Published: ${eventType} | campaign: ${campaignId}`);
        this.history.push(event);

        const handlers = this.subscribers.get(eventType) || new Set();
        handlers.forEach(handler => {
            // 异步执行，不阻塞发布者
            Promise.resolve().then(() => handler(event)).catch(err => {
                console.error(`[EventBus] Handler error for ${eventType}:`, err);
            });
        });

        return event.id;
    }

    /**
     * 订阅事件
     */
    subscribe(eventType, handler) {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, new Set());
        }
        this.subscribers.get(eventType).add(handler);

        // 返回取消订阅函数
        return () => this.subscribers.get(eventType)?.delete(handler);
    }

    /**
     * 查询历史事件
     */
    getHistory(campaignId) {
        return this.history.filter(e => !campaignId || e.campaign_id === campaignId);
    }
}

// 全局单例
export const globalEventBus = new EventBus();
