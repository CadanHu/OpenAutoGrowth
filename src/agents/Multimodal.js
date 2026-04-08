/**
 * Multimodal Agent — 视觉素材生成
 * 重构版：按 docs/architecture/01-agent-design.md 规范，支持风格一致性与多尺寸适配
 */
import { globalEventBus } from '../core/EventBus.js';

// 平台标准尺寸映射
const PLATFORM_SIZES = {
    tiktok:  ['9:16'],
    meta:    ['1:1', '4:5', '9:16'],
    google:  ['16:9', '1:1'],
    wechat:  ['1:1', '4:3'],
    default: ['1:1', '9:16'],
};

// 工具优先级（Primary → Fallback）
const TOOL_PRIORITY = {
    image: ['DALLE3', 'STABILITY_AI', 'MIDJOURNEY'],
    video: ['RUNWAY', 'PIKA', 'COGVIDEOX'],
};

export class MultimodalAgent {
    constructor() {
        this.agentType = 'MULTIMODAL';
    }

    /**
     * @param {object} params
     * @param {'image'|'video'} params.type    - 生成类型
     * @param {string}  params.topic           - 关联话题/产品名
     * @param {string}  params.style           - 'minimalist' | 'vibrant' | 'professional'
     * @param {string[]} params.brand_colors   - 品牌色列表
     * @param {string[]} params.sizes          - 指定尺寸，留空则按渠道自动推断
     * @param {string[]} params.channels       - ['tiktok','meta'] 用于推断尺寸
     * @param {number}  params.duration        - 视频时长（秒），仅 video
     * @param {string}  params.campaign_id
     * @param {object}  params.context         - 上游结果（可含 Strategy 输出）
     */
    async run(params) {
        const {
            type = 'image',
            topic = '',
            style = 'vibrant',
            brand_colors = ['#6366f1', '#a855f7'],
            sizes,
            channels = ['tiktok', 'meta'],
            duration = 15,
            campaign_id,
            context = {},
        } = params;

        // 从上游 Strategy 结果推断渠道
        const activeChannels = context?.t1?.channel_plan?.map(c => c.channel) || channels;
        const targetSizes = sizes || this._inferSizes(activeChannels, type);
        const prompt = this._buildPrompt({ topic, style, brand_colors, type });
        const tool = TOOL_PRIORITY[type][0];

        console.log(`[Multimodal] 🎨 Generating ${type}(s) | Tool: ${tool} | Sizes: ${targetSizes.join(', ')}`);
        await this._simulateLatency(type === 'video' ? 2500 : 1500);

        const assets = targetSizes.map((size, idx) => ({
            id:           `asset_${type}_${Date.now()}_${idx}`,
            type:         type.toUpperCase(),
            url:          `https://cdn.openautogrowth.ai/assets/${campaign_id}/${type}_${size.replace(':', 'x')}_${Date.now()}.${type === 'video' ? 'mp4' : 'png'}`,
            thumbnail_url: type === 'video'
                ? `https://cdn.openautogrowth.ai/thumbs/${campaign_id}/thumb_${idx}.jpg`
                : null,
            tool,
            aspect_ratio: size,
            width_px:     this._sizeToPixels(size).w,
            height_px:    this._sizeToPixels(size).h,
            duration_sec: type === 'video' ? duration : null,
            prompt,
            status: 'GENERATED',
        }));

        const output = {
            agent:    this.agentType,
            assets,
            metadata: {
                tool,
                style,
                prompt,
                generated_at: new Date().toISOString(),
            },
        };

        globalEventBus.publish('AssetsGenerated', {
            asset_ids: assets.map(a => a.id),
            type,
        }, campaign_id);

        return output;
    }

    /**
     * 根据渠道和类型推断所需尺寸（去重）
     */
    _inferSizes(channels, type) {
        if (type === 'video') return ['9:16'];  // 短视频统一竖屏
        const sizeSets = channels.flatMap(ch => PLATFORM_SIZES[ch] || PLATFORM_SIZES.default);
        return [...new Set(sizeSets)];
    }

    /**
     * 构建生成 Prompt（生产环境替换为 LLM 动态生成）
     */
    _buildPrompt({ topic, style, brand_colors, type }) {
        const styleMap = {
            minimalist:    'clean white background, minimal design, modern typography',
            vibrant:       'bold colors, dynamic composition, high energy',
            professional:  'corporate style, professional lighting, trust-building aesthetic',
        };
        const base = styleMap[style] || styleMap['vibrant'];
        const colorHint = brand_colors.slice(0, 2).join(' and ');

        return type === 'video'
            ? `${topic} product reveal video, ${base}, brand colors ${colorHint}, cinematic quality, 4K`
            : `${topic} advertisement, ${base}, accent colors ${colorHint}, social media ready, sharp details`;
    }

    _sizeToPixels(ratio) {
        const map = {
            '9:16': { w: 1080, h: 1920 },
            '1:1':  { w: 1080, h: 1080 },
            '4:5':  { w: 1080, h: 1350 },
            '16:9': { w: 1920, h: 1080 },
            '4:3':  { w: 1440, h: 1080 },
        };
        return map[ratio] || { w: 1080, h: 1080 };
    }

    _simulateLatency(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
