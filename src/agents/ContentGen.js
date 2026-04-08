/**
 * ContentGen Agent — 文案生成
 * 重构版：按 docs/architecture/01-agent-design.md 规范
 */
import { globalEventBus } from '../core/EventBus.js';

export class ContentGenAgent {
    constructor({ llmProvider } = {}) {
        this.llmProvider = llmProvider;
        this.agentType   = 'CONTENT_GEN';
    }

    /**
     * @param {object} params
     * @param {object} params.product - { name, category, USP[] }
     * @param {object} params.target_persona - { age, interest[] }
     * @param {string[]} params.channels - ['tiktok', 'weibo']
     * @param {string}   params.tone - 'energetic' | 'professional' | 'warm'
     * @param {number}   params.ab_variants - 默认 3
     * @param {string}   params.campaign_id
     */
    async run(params) {
        const { product, target_persona, channels = [], tone = 'energetic',
                ab_variants = 3, campaign_id } = params;

        console.log(`[ContentGen] 📝 Generating ${ab_variants} variants for "${product?.name || 'product'}"`);

        const variants = await this._generateVariants({ product, target_persona, channels, tone, ab_variants });

        const output = {
            agent:    this.agentType,
            variants: variants,
            metadata: {
                language:       'zh-CN',
                word_count_avg: Math.round(variants.reduce((s, v) => s + v.body.length, 0) / variants.length),
                generated_at:   new Date().toISOString(),
            }
        };

        globalEventBus.publish('ContentGenerated', { bundle: output, campaign_id }, campaign_id);
        return output;
    }

    async _generateVariants({ product, target_persona, tone, ab_variants }) {
        // 模拟 LLM 生成（生产环境替换为真实 API 调用）
        await this._simulateLatency(1500);

        const hooks = [
            `${product?.USP?.[0] || '全新功能'}，让你效率翻倍`,
            `${target_persona?.age || '年轻人'}都在用的${product?.name || '好工具'}`,
            `告别低效，${product?.name || '它'}来了`,
        ];

        return Array.from({ length: ab_variants }, (_, i) => ({
            id:        `copy_v${String.fromCharCode(65 + i)}`,  // copy_vA, copy_vB...
            variant:   String.fromCharCode(65 + i),              // 'A', 'B', 'C'
            hook:      hooks[i] || `版本 ${i + 1} 标题`,
            body:      `${product?.name || '产品'} 专为 ${target_persona?.age || '用户'} 设计，${product?.USP?.join('、') || '功能强大'}。立即体验！`,
            cta:       ['免费试用', '立即体验', '查看案例'][i] || '了解更多',
            tone,
            word_count: 45 + Math.floor(Math.random() * 30),
            llm_model: 'claude-3-5-sonnet-mock',
        }));
    }

    _simulateLatency(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
