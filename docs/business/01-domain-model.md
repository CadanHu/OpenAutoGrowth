# 领域建模 (DDD) — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-08

本文档采用**领域驱动设计（DDD）**方法对 OpenAutoGrowth 的业务领域进行建模，划定限界上下文，识别聚合根和领域对象。

---

## 1. 战略设计：限界上下文划分

系统共划分为 **5 个限界上下文（Bounded Contexts）**，每个上下文拥有独立的语言模型和数据所有权：

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenAutoGrowth                             │
│                                                                  │
│  ┌─────────────────┐   ┌─────────────────┐                      │
│  │  🎯 Campaign     │   │  📝 Content      │                      │
│  │  Management     │   │  Production     │                      │
│  │  (核心域)        │   │  (支撑域)        │                      │
│  └────────┬────────┘   └────────┬────────┘                      │
│           │                     │                               │
│  ┌────────▼────────┐   ┌────────▼────────┐                      │
│  │  📡 Ad          │   │  📊 Analytics   │                      │
│  │  Execution      │   │  & Attribution  │                      │
│  │  (支撑域)        │   │  (支撑域)        │                      │
│  └─────────────────┘   └─────────────────┘                      │
│                                                                  │
│  ┌──────────────────────────────────────┐                       │
│  │  🧠 AI Orchestration (通用域)         │                       │
│  │  Orchestrator / Planner / Memory     │                       │
│  └──────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

### 上下文关系（Context Map）

```
Campaign Management  ──[客户-供应商]──▶  Content Production
Campaign Management  ──[客户-供应商]──▶  Ad Execution
Campaign Management  ──[发布-订阅]──▶   Analytics & Attribution
Analytics            ──[发布-订阅]──▶   AI Orchestration
AI Orchestration     ──[防腐层(ACL)]──▶ 全部外部平台 API
```

---

## 2. 战术设计：聚合根与领域对象

### 2.1 Campaign Management 上下文

```
Campaign（聚合根）
├── id: CampaignId
├── goal: GrowthGoal           值对象
│   ├── description: String
│   ├── kpi: KPI               值对象
│   │   ├── metric: Enum(GMV/CTR/ROI/CVR)
│   │   └── target: Decimal
│   └── timeline: DateRange
├── budget: Budget             值对象
│   ├── total: Money
│   ├── daily_cap: Money
│   └── currency: Enum
├── status: CampaignStatus     枚举（见状态机文档）
├── loop_count: Integer        优化闭环次数
└── plan: Plan                 实体
    ├── id: PlanId
    ├── tasks: List[Task]      实体
    │   ├── id: TaskId
    │   ├── agent_type: AgentType
    │   ├── dependencies: List[TaskId]
    │   ├── status: TaskStatus
    │   └── result: TaskResult  值对象
    └── dag_snapshot: JSON      DAG 的快照
```

### 2.2 Content Production 上下文

```
ContentBundle（聚合根）
├── id: BundleId
├── campaign_id: CampaignId    关联
├── copies: List[Copy]         实体
│   ├── id: CopyId
│   ├── variant: Enum(A/B/C)
│   ├── channel: ChannelType
│   ├── hook: String           吸引眼球的第一句话
│   ├── body: String
│   ├── cta: String            行动号召语
│   └── status: CopyStatus     (GENERATING/APPROVED/LIVE/ARCHIVED)
└── assets: List[ContentAsset] 实体
    ├── id: AssetId
    ├── type: Enum(IMAGE/VIDEO)
    ├── url: URL
    ├── tool: Enum(DALLE/MIDJOURNEY/RUNWAY/PIKA)
    ├── dimensions: Size        值对象
    └── status: AssetStatus

StyleGuide（实体，跨 Campaign 共享）
├── brand_id: BrandId
├── primary_colors: List[HexColor]
├── fonts: List[FontSpec]
└── tone_keywords: List[String]
```

### 2.3 Ad Execution 上下文

```
AdCampaign（聚合根，对应平台侧的 Campaign）
├── id: AdCampaignId
├── platform: Enum(META/GOOGLE/TIKTOK/WECHAT)
├── external_id: String        平台返回的 Campaign ID
├── ad_groups: List[AdGroup]   对应 AdSet/AdGroup
│   ├── id: AdGroupId
│   ├── external_id: String
│   ├── audience: Audience     实体
│   │   ├── age_range: AgeRange
│   │   ├── interests: List[String]
│   │   ├── geo: List[GeoCode]
│   │   └── lookalike_source: AudienceId?
│   ├── bid_strategy: BidStrategy 值对象
│   │   ├── type: Enum(CPM/CPC/ROAS_TARGET)
│   │   └── target_value: Decimal
│   └── ads: List[Ad]          实体
│       ├── id: AdId
│       ├── copy_id: CopyId    关联 Content
│       ├── asset_id: AssetId  关联 Content
│       └── status: AdStatus
└── spend: Money               已花费金额（实时）
```

### 2.4 Analytics & Attribution 上下文

```
PerformanceReport（聚合根）
├── id: ReportId
├── campaign_id: CampaignId
├── period: DateRange
├── summary: ReportSummary     值对象
│   ├── spend: Money
│   ├── impressions: Integer
│   ├── clicks: Integer
│   ├── conversions: Integer
│   ├── revenue: Money
│   └── kpis: KPISnapshot      值对象（CTR/CVR/ROAS/ROI）
├── by_channel: List[ChannelStats]
├── by_variant: List[VariantStats]  文案/素材维度归因
└── anomalies: List[Anomaly]   异常事件列表

Attribution（实体）
├── model: Enum(LAST_CLICK/DATA_DRIVEN/LINEAR/POSITION_BASED)
├── touchpoints: List[Touchpoint]
└── contribution_weights: Map[AdId, Decimal]
```

### 2.5 AI Orchestration 上下文

```
AgentContext（聚合根）
├── session_id: SessionId
├── campaign_id: CampaignId
├── memory: ContextMemory      实体
│   ├── short_term: List[Message]   最近 N 轮交互
│   └── long_term: VectorIndex      历史成功案例（语义检索）
└── tool_registry: ToolRegistry 实体
    └── tools: Map[ToolName, ToolConfig]

OptimizationRecord（实体，写入 Memory）
├── id: RecordId
├── loop_number: Integer
├── actions_taken: List[OptAction]
├── effect_validated: Boolean
└── learnings: String          自然语言总结，供下次 Planner 参考
```

---

## 3. 领域事件清单

| 事件 | 发布方（上下文） | 订阅方（上下文） | 数据 |
| :--- | :--- | :--- | :--- |
| `CampaignCreated` | Campaign Management | AI Orchestration | campaign_id, goal |
| `PlanGenerated` | AI Orchestration | Campaign Management | plan_id, task_dag |
| `ContentApproved` | Content Production | Campaign Management | bundle_id, copy_ids |
| `AdDeployed` | Ad Execution | Campaign Management | ad_campaign_id, platform |
| `ReportGenerated` | Analytics | AI Orchestration | report_id, summary |
| `OptimizationApplied` | AI Orchestration | Ad Execution | actions |
| `KPIAchieved` | Campaign Management | 全部上下文 | campaign_id, final_metrics |
| `AnomalyDetected` | Analytics | AI Orchestration, Campaign Management | anomaly_type, severity |
