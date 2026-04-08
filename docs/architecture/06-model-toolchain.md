# 模型工具链选型 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-09

---

## 1. 选型原则

| 原则 | 说明 |
| :--- | :--- |
| **场景适配** | 不同任务选型不同，避免"大炮打蚊子" |
| **成本控制** | 高频低难度任务优先用小模型，复杂任务才用大模型 |
| **可降级** | 每个工具都有备选方案（Primary / Fallback） |
| **可换厂商** | 通过 Tool Registry 统一抽象，换厂商只改配置 |

---

## 2. LLM 选型（文字类任务）

| 任务 | Primary Model | Fallback | 选型理由 |
| :--- | :--- | :--- | :--- |
| **Planner DAG 生成** | GPT-4o | Claude 3.5 Sonnet | 需要强逻辑和 JSON 结构化输出 |
| **Orchestrator 目标解析** | GPT-4o | Gemini 1.5 Pro | 复杂意图理解 |
| **ContentGen 文案生成** | Claude 3.5 Sonnet | GPT-4o | 创意写作更强，中文效果好 |
| **Optimizer 模糊决策** | GPT-4o with Tools | Claude 3.5 Sonnet | 需要调用规则工具 |
| **批量内容改写** | GPT-4o Mini | Gemini 1.5 Flash | 高频低成本 |
| **内容安全审核** | LlamaGuard 3 | Azure Content Safety | 专用安全模型，成本低 |

### LLM API 抽象层

```typescript
interface LLMProvider {
  name: string;
  call(params: LLMCallParams): Promise<LLMResponse>;
  stream(params: LLMCallParams): AsyncIterator<string>;
  embed(text: string): Promise<number[]>;
  token_count(text: string): number;
}

// 统一接口，底层实现替换对上层透明
class LLMRouter {
  private providers: Map<string, LLMProvider>;

  async route(task: TaskType, params: LLMCallParams): Promise<LLMResponse> {
    const primary = this.selectModel(task);
    try {
      return await primary.call(params);
    } catch (e) {
      const fallback = this.getFallback(task);
      return await fallback.call(params);
    }
  }
}
```

---

## 3. 视觉生成工具链（图片 & 视频）

```
图片生成:
  Primary:   OpenAI DALL-E 3     (高质量、API 稳定、消费级)
  Secondary: Stability AI SDXL   (可自部署、成本低)
  Future:    Midjourney API v2    (最高质量，待 API 公测)

视频生成:
  Primary:   Runway Gen-3 Alpha  (15s/30s，效果最佳)
  Secondary: Pika 2.0            (快速迭代，成本更低)
  Future:    Sora API            (OpenAI，待商业化)
  Local:     CogVideoX           (开源，可本地部署)

图像理解（素材打标）:
  Primary:   GPT-4o Vision       (多模态，直接调用)
  Secondary: Gemini 1.5 Pro     (长上下文解析)
```

---

## 4. 向量与记忆工具链

```
向量数据库（长期语义记忆）:
  Primary:   Pinecone            (托管，无运维，性能强)
  Alternative: Qdrant            (可自部署，开源)
  Alternative: pgvector          (在现有 PG 上开启扩展，成本最低)

Embedding 模型:
  Primary:   text-embedding-3-large  (OpenAI, 3072维)
  Secondary: Cohere embed-v3         (多语言支持更好)

缓存（短期上下文）:
  Redis Stack (RedisJSON + RedisSearch)
```

---

## 5. 广告平台 API 工具链

| 平台 | API 版本 | 认证方式 | 限流 | 沙箱支持 |
| :--- | :--- | :--- | :--- | :--- |
| **Meta** | Marketing API v18.0 | OAuth 2.0 + Long-lived Token | 200 req/hr/user | ✅ |
| **Google Ads** | Ads API v15 | OAuth 2.0 | 15,000 ops/day | ✅ |
| **TikTok** | for Business API v1.3 | OAuth 2.0 | 600 req/min | ✅ |
| **微信广告** | Ads API | AppID+Secret | 1000 req/min | 部分 |

### 统一 Ads API Adapter

```typescript
interface AdsAPIAdapter {
  createCampaign(params: CampaignParams): Promise<{ external_id: string }>;
  createAdGroup(params: AdGroupParams): Promise<{ external_id: string }>;
  uploadAsset(file: Buffer, type: 'image' | 'video'): Promise<{ asset_id: string }>;
  createAd(params: AdParams): Promise<{ ad_id: string }>;
  pauseAd(ad_id: string): Promise<void>;
  getMetrics(ad_ids: string[], date_range: DateRange): Promise<MetricsData>;
}

// 每个平台实现此接口
class MetaAdsAdapter implements AdsAPIAdapter { ... }
class TikTokAdsAdapter implements AdsAPIAdapter { ... }
class GoogleAdsAdapter implements AdsAPIAdapter { ... }
```

---

## 6. 数据分析工具链

```
数据采集:
  实时:  各平台 Webhook / Streaming API
  批量:  各平台 Reporting API（每小时拉取）

归因分析:
  Primary:   自研归因引擎（基于 Shapley Value）
  Secondary: Adjust / AppsFlyer SDK（移动端场景）

数据存储:
  热数据:  TimescaleDB（时序数据库，基于 PG）
  冷数据:  S3 + Apache Parquet（低成本存档）

BI / 可视化:
  内置 Dashboard: React + Recharts
  外接 BI:        Metabase（开源）/ Grafana
```

---

## 7. 工具链成本估算（月度，中等规模）

| 工具 | 估算用量 | 月成本（USD） |
| :--- | :--- | :--- |
| OpenAI GPT-4o | 2M tokens/月 | ~$10 |
| OpenAI GPT-4o Mini | 10M tokens/月 | ~$1.5 |
| DALL-E 3 | 500 images/月 | ~$60 |
| Runway Gen-3 | 100 videos/月 | ~$95 |
| Pinecone (Starter) | 1M vectors | ~$70 |
| Redis Cloud | 1GB | ~$10 |
| PostgreSQL (RDS) | db.t3.medium | ~$30 |
| **合计** | | **~$277/月** |
