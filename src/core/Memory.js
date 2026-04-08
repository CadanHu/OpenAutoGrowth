/**
 * Memory System — 上下文记忆与历史检索
 * 支持短期（运行时 Map）+ 长期（向量语义检索的模拟层）
 * 生产环境：长期记忆对接 Pinecone / pgvector
 */
export class Memory {
    constructor() {
        // 短期记忆：当前 session 内的键值存储
        this.shortTerm = new Map();

        // 长期记忆：模拟向量索引（生产替换为 Pinecone SDK）
        this.longTerm = [];
    }

    // ── 短期记忆 ────────────────────────────────────────────

    save(key, value) {
        this.shortTerm.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    get(key) {
        return this.shortTerm.get(key)?.value ?? null;
    }

    delete(key) {
        this.shortTerm.delete(key);
    }

    // ── 长期记忆（持久化 + 语义检索） ──────────────────────

    /**
     * 将优化经验固化到长期记忆
     * @param {object} record - { campaign_id, goal, learnings, kpi_before, kpi_after }
     */
    persist(record) {
        const entry = {
            id:          `mem_${Date.now()}`,
            type:        record.type || 'OPTIMIZATION_LEARNING',
            campaign_id: record.campaign_id,
            content:     record.learnings || JSON.stringify(record),
            metadata:    record,
            // 生产环境：此处调用 text-embedding-3-large 生成向量
            embedding:   this._mockEmbedding(record.learnings || ''),
            created_at:  new Date().toISOString(),
        };
        this.longTerm.push(entry);
        console.log(`[Memory] 💾 Persisted: ${entry.id} (${entry.type})`);
        return entry.id;
    }

    /**
     * 语义相似检索（生产环境替换为 Pinecone query）
     * @param {string} query - 自然语言查询
     * @param {number} topK  - 返回数量
     */
    getSimilar(query, topK = 3) {
        // 简化实现：关键词匹配（生产环境为向量余弦相似度）
        const queryWords = query.toLowerCase().split(/\s+/);
        return this.longTerm
            .map(entry => ({
                ...entry,
                score: queryWords.filter(w => entry.content.toLowerCase().includes(w)).length,
            }))
            .filter(e => e.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    /**
     * 获取 Campaign 完整上下文历史
     */
    getCampaignHistory(campaignId) {
        return {
            shortTerm: [...this.shortTerm.entries()]
                .filter(([k]) => k.startsWith(campaignId))
                .map(([k, v]) => ({ key: k, ...v })),
            longTerm: this.longTerm.filter(e => e.campaign_id === campaignId),
        };
    }

    // Mock 向量生成（生产替换为真实 Embedding API）
    _mockEmbedding(text) {
        return Array.from({ length: 8 }, () => Math.random() - 0.5);
    }
}

/**
 * ToolRegistry — Agent 工具注册中心
 * 每个 Agent 通过 Registry 获取外部 API 连接器，避免直接硬编码
 */
export class ToolRegistry {
    constructor() {
        this.tools = new Map();
        this._registerDefaults();
    }

    register(name, toolFn) {
        this.tools.set(name, toolFn);
        console.log(`[ToolRegistry] ✅ Registered tool: ${name}`);
    }

    use(name) {
        const tool = this.tools.get(name);
        if (!tool) throw new Error(`Tool "${name}" not found in registry`);
        return tool;
    }

    list() {
        return [...this.tools.keys()];
    }

    _registerDefaults() {
        // 广告平台（Mock）
        this.register('MetaAdsAPI',    () => console.log('[Tool] Calling Meta Ads API...'));
        this.register('GoogleAdsAPI',  () => console.log('[Tool] Calling Google Ads API...'));
        this.register('TikTokAdsAPI',  () => console.log('[Tool] Calling TikTok Ads API...'));

        // AI 工具（Mock）
        this.register('OpenAI_GPT4o',  (prompt) => `[Mock LLM Response for: ${prompt.slice(0, 30)}...]`);
        this.register('DALLE3',        (prompt) => `https://mock-cdn.openai.com/img/${Date.now()}.png`);
        this.register('RunwayGen3',    (prompt) => `https://mock-cdn.runway.ai/vid/${Date.now()}.mp4`);

        // 数据平台（Mock）
        this.register('GoogleAnalytics', () => ({ sessions: 12000, bounce_rate: 0.42 }));
    }
}
