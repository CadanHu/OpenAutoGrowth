/**
 * WSBroadcaster — 对接后端真实 WebSocket (:9393)
 * 替换原浏览器内 EventBus 回调模拟层。
 */

const WS_BASE = 'ws://localhost:9393/ws';

export class WSBroadcaster {
    constructor() {
        // Map<campaignId, { socket: WebSocket, callbacks: Set<Function> }>
        this._connections = new Map();
    }

    /**
     * 订阅某个 Campaign 的实时推送。
     * @param {string}   campaignId
     * @param {Function} callback  - (message) => void
     * @returns {Function} unsubscribe
     */
    subscribe(campaignId, callback) {
        if (!this._connections.has(campaignId)) {
            this._connect(campaignId);
        }

        const entry = this._connections.get(campaignId);
        entry.callbacks.add(callback);
        console.log(`[WS] Subscribed to campaign: ${campaignId}`);

        return () => {
            entry.callbacks.delete(callback);
            if (entry.callbacks.size === 0) {
                entry.socket?.close();
                this._connections.delete(campaignId);
                console.log(`[WS] Connection closed for campaign: ${campaignId}`);
            }
        };
    }

    // ── Internal ──────────────────────────────────────────────────────────

    _connect(campaignId) {
        const socket = new WebSocket(`${WS_BASE}/${campaignId}`);
        const entry = { socket, callbacks: new Set() };
        this._connections.set(campaignId, entry);

        socket.onopen = () => {
            console.log(`[WS] Connected: ${campaignId}`);
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                // Handle pong / system messages silently
                if (message.type === 'pong' || message.type === 'connected') return;

                entry.callbacks.forEach(cb => cb(message));
            } catch (err) {
                console.warn('[WS] Failed to parse message:', err);
            }
        };

        socket.onerror = (err) => {
            console.error(`[WS] Error on campaign ${campaignId}:`, err);
        };

        socket.onclose = (event) => {
            console.log(`[WS] Disconnected: ${campaignId} (code ${event.code})`);
            this._connections.delete(campaignId);

            // Reconnect after 3s if there are still active subscribers
            if (entry.callbacks.size > 0) {
                setTimeout(() => {
                    if (entry.callbacks.size > 0) {
                        console.log(`[WS] Reconnecting: ${campaignId}`);
                        this._connect(campaignId);
                        // Re-attach existing callbacks to new connection
                        const newEntry = this._connections.get(campaignId);
                        if (newEntry) newEntry.callbacks = entry.callbacks;
                    }
                }, 3000);
            }
        };

        // Keepalive ping every 30s
        const pingInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            } else {
                clearInterval(pingInterval);
            }
        }, 30_000);
    }
}

// Global singleton
export const wsBroadcaster = new WSBroadcaster();
