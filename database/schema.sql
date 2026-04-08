-- ============================================================
-- OpenAutoGrowth — Database Schema (DDL)
-- Version: 1.0 | Updated: 2026-04-09
-- Database: PostgreSQL 15+
-- Extensions: pgcrypto (UUID), pgvector (embeddings)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgvector";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE campaign_status AS ENUM (
    'DRAFT', 'PLANNING', 'PLANNING_FAILED',
    'PENDING_REVIEW', 'PRODUCTION', 'PRODUCTION_FAILED',
    'DEPLOYED', 'MONITORING', 'OPTIMIZING',
    'LOOP_1', 'LOOP_2', 'LOOP_3', 'LOOP_4', 'LOOP_5',
    'PAUSED', 'COMPLETED'
);

CREATE TYPE task_status AS ENUM (
    'PENDING', 'WAITING', 'RUNNING', 'DONE',
    'FAILED', 'BLOCKED', 'SKIPPED'
);

CREATE TYPE agent_type AS ENUM (
    'PLANNER', 'CONTENT_GEN', 'MULTIMODAL',
    'STRATEGY', 'CHANNEL_EXEC', 'ANALYSIS', 'OPTIMIZER'
);

CREATE TYPE content_status AS ENUM (
    'GENERATING', 'GENERATED', 'REVIEWING',
    'APPROVED', 'REJECTED', 'LIVE', 'PAUSED',
    'REPLACED', 'ARCHIVED'
);

CREATE TYPE asset_type AS ENUM ('IMAGE', 'VIDEO');

CREATE TYPE visual_tool AS ENUM (
    'DALLE3', 'MIDJOURNEY', 'STABILITY_AI',
    'RUNWAY', 'PIKA', 'SORA', 'COGVIDEOX'
);

CREATE TYPE channel_type AS ENUM (
    'META', 'GOOGLE', 'TIKTOK', 'WECHAT', 'WEIBO'
);

CREATE TYPE ad_status AS ENUM (
    'PENDING', 'ACTIVE', 'PAUSED', 'REPLACED', 'DELETED'
);

CREATE TYPE bid_strategy_type AS ENUM (
    'CPM', 'CPC', 'CPV', 'ROAS_TARGET', 'CPA_TARGET'
);

CREATE TYPE kpi_metric AS ENUM (
    'GMV', 'CTR', 'CVR', 'ROAS', 'ROI', 'CAC', 'REACH'
);

CREATE TYPE attribution_model AS ENUM (
    'LAST_CLICK', 'FIRST_CLICK', 'LINEAR',
    'POSITION_BASED', 'DATA_DRIVEN'
);

CREATE TYPE opt_loop_status AS ENUM (
    'TRIGGERED', 'ANALYZING', 'DECISION_MADE',
    'NO_ACTION', 'EXECUTING', 'WAIT_EFFECT',
    'EFFECT_VALIDATED', 'EFFECT_FAILED', 'ROLLBACK', 'COMMITTED'
);

CREATE TYPE currency_code AS ENUM ('CNY', 'USD', 'EUR', 'GBP');

CREATE TYPE user_role AS ENUM ('ADMIN', 'MARKETER', 'VIEWER');

-- ============================================================
-- TABLE: organizations
-- ============================================================
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    plan        VARCHAR(50)  NOT NULL DEFAULT 'STARTER',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL UNIQUE,
    role        user_role    NOT NULL DEFAULT 'MARKETER',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_org ON users(org_id);

-- ============================================================
-- TABLE: campaigns  [核心聚合根]
-- ============================================================
CREATE TABLE campaigns (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID          NOT NULL REFERENCES organizations(id),
    owner_id            UUID          NOT NULL REFERENCES users(id),
    name                VARCHAR(200)  NOT NULL,
    goal_description    TEXT          NOT NULL,
    kpi_metric          kpi_metric    NOT NULL,
    kpi_target          DECIMAL(18,4) NOT NULL,
    budget_total        DECIMAL(18,2) NOT NULL CHECK (budget_total > 0),
    budget_daily_cap    DECIMAL(18,2),
    currency            currency_code NOT NULL DEFAULT 'CNY',
    start_date          DATE          NOT NULL,
    end_date            DATE          NOT NULL CHECK (end_date >= start_date),
    status              campaign_status NOT NULL DEFAULT 'DRAFT',
    loop_count          INTEGER       NOT NULL DEFAULT 0 CHECK (loop_count >= 0),
    total_spend         DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_revenue       DECIMAL(18,2) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT budget_daily_le_total CHECK (
        budget_daily_cap IS NULL OR budget_daily_cap <= budget_total
    )
);
CREATE INDEX idx_campaigns_org    ON campaigns(org_id);
CREATE INDEX idx_campaigns_owner  ON campaigns(owner_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_dates  ON campaigns(start_date, end_date);

-- ============================================================
-- TABLE: plans  [Task DAG 规划]
-- ============================================================
CREATE TABLE plans (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID        NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
    dag_json        JSONB       NOT NULL,
    generated_by    VARCHAR(50) NOT NULL DEFAULT 'PLANNER_AGENT',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: tasks  [DAG 节点]
-- ============================================================
CREATE TABLE tasks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         UUID        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    campaign_id     UUID        NOT NULL REFERENCES campaigns(id),
    task_key        VARCHAR(50) NOT NULL,   -- 'tl', 't2', etc.
    agent_type      agent_type  NOT NULL,
    dependency_ids  UUID[]      NOT NULL DEFAULT '{}',
    parallel_group  VARCHAR(50),
    status          task_status NOT NULL DEFAULT 'PENDING',
    input_params    JSONB,
    output_result   JSONB,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    retry_count     INTEGER     NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (plan_id, task_key)
);
CREATE INDEX idx_tasks_plan_id    ON tasks(plan_id);
CREATE INDEX idx_tasks_campaign   ON tasks(campaign_id);
CREATE INDEX idx_tasks_status     ON tasks(status);
CREATE INDEX idx_tasks_agent_type ON tasks(agent_type);

-- ============================================================
-- TABLE: style_guides  [品牌风格库，跨 Campaign 共享]
-- ============================================================
CREATE TABLE style_guides (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    primary_colors  TEXT[]      NOT NULL DEFAULT '{}',
    secondary_colors TEXT[]     NOT NULL DEFAULT '{}',
    fonts           JSONB       NOT NULL DEFAULT '[]',
    tone_keywords   TEXT[]      NOT NULL DEFAULT '{}',
    logo_url        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: content_bundles  [内容打包单元]
-- ============================================================
CREATE TABLE content_bundles (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    style_guide_id  UUID        REFERENCES style_guides(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bundles_campaign ON content_bundles(campaign_id);

-- ============================================================
-- TABLE: copies  [营销文案]
-- ============================================================
CREATE TABLE copies (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id       UUID            NOT NULL REFERENCES content_bundles(id) ON DELETE CASCADE,
    campaign_id     UUID            NOT NULL REFERENCES campaigns(id),
    ab_variant      CHAR(1)         NOT NULL CHECK (ab_variant IN ('A','B','C','D')),
    channel         channel_type    NOT NULL,
    hook            VARCHAR(200)    NOT NULL,
    body            TEXT            NOT NULL,
    cta             VARCHAR(80)     NOT NULL,
    tone            VARCHAR(50),
    word_count      INTEGER,
    llm_model       VARCHAR(50),
    status          content_status  NOT NULL DEFAULT 'GENERATING',
    rejection_reason TEXT,
    embedding       vector(1536),   -- 语义向量，用于相似搜索
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_copies_bundle    ON copies(bundle_id);
CREATE INDEX idx_copies_campaign  ON copies(campaign_id);
CREATE INDEX idx_copies_status    ON copies(status);
CREATE INDEX idx_copies_embedding ON copies USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- TABLE: content_assets  [视觉素材]
-- ============================================================
CREATE TABLE content_assets (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id       UUID            NOT NULL REFERENCES content_bundles(id) ON DELETE CASCADE,
    campaign_id     UUID            NOT NULL REFERENCES campaigns(id),
    type            asset_type      NOT NULL,
    url             TEXT            NOT NULL,
    thumbnail_url   TEXT,
    tool            visual_tool     NOT NULL,
    width_px        INTEGER,
    height_px       INTEGER,
    duration_sec    INTEGER,        -- 视频时长
    aspect_ratio    VARCHAR(10),    -- '9:16', '1:1', etc.
    prompt          TEXT,
    status          content_status  NOT NULL DEFAULT 'GENERATING',
    platform_asset_ids JSONB        DEFAULT '{}', -- {meta: "xxx", tiktok: "yyy"}
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_assets_bundle   ON content_assets(bundle_id);
CREATE INDEX idx_assets_campaign ON content_assets(campaign_id);
CREATE INDEX idx_assets_type     ON content_assets(type);

-- ============================================================
-- TABLE: ad_campaigns  [平台广告活动]
-- ============================================================
CREATE TABLE ad_campaigns (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID            NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    platform        channel_type    NOT NULL,
    external_id     VARCHAR(100)    UNIQUE,       -- 平台侧 ID
    name            VARCHAR(200)    NOT NULL,
    status          ad_status       NOT NULL DEFAULT 'PENDING',
    spend_cap       DECIMAL(18,2),
    total_spend     DECIMAL(18,2)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ad_campaigns_campaign ON ad_campaigns(campaign_id);
CREATE INDEX idx_ad_campaigns_platform ON ad_campaigns(platform);

-- ============================================================
-- TABLE: ad_groups  [广告组/AdSet]
-- ============================================================
CREATE TABLE ad_groups (
    id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_campaign_id  UUID                NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
    external_id     VARCHAR(100),
    name            VARCHAR(200)        NOT NULL,
    audience_config JSONB               NOT NULL DEFAULT '{}',
    budget_amount   DECIMAL(18,2)       NOT NULL,
    bid_strategy    bid_strategy_type   NOT NULL,
    bid_target_value DECIMAL(18,4),
    schedule_start  TIMESTAMPTZ,
    schedule_end    TIMESTAMPTZ,
    status          ad_status           NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ad_groups_ad_campaign ON ad_groups(ad_campaign_id);

-- ============================================================
-- TABLE: ads  [广告创意单元]
-- ============================================================
CREATE TABLE ads (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_group_id     UUID        NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
    copy_id         UUID        NOT NULL REFERENCES copies(id),
    asset_id        UUID        REFERENCES content_assets(id),
    platform_ad_id  VARCHAR(100) UNIQUE,  -- 平台侧广告 ID
    status          ad_status   NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ads_ad_group ON ads(ad_group_id);
CREATE INDEX idx_ads_copy     ON ads(copy_id);
CREATE INDEX idx_ads_status   ON ads(status);

-- ============================================================
-- TABLE: performance_reports  [绩效报告（聚合）]
-- ============================================================
CREATE TABLE performance_reports (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID                NOT NULL REFERENCES campaigns(id),
    period_start        DATE                NOT NULL,
    period_end          DATE                NOT NULL,
    attribution_model   attribution_model   NOT NULL DEFAULT 'LAST_CLICK',
    total_spend         DECIMAL(18,2)       NOT NULL DEFAULT 0,
    total_revenue       DECIMAL(18,2)       NOT NULL DEFAULT 0,
    impressions         BIGINT              NOT NULL DEFAULT 0,
    clicks              INTEGER             NOT NULL DEFAULT 0,
    conversions         INTEGER             NOT NULL DEFAULT 0,
    ctr                 DECIMAL(10,6),
    cvr                 DECIMAL(10,6),
    cpa                 DECIMAL(18,2),
    roas                DECIMAL(10,4),
    roi                 DECIMAL(10,4),
    has_anomalies       BOOLEAN             NOT NULL DEFAULT FALSE,
    generated_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    UNIQUE (campaign_id, period_start, period_end, attribution_model)
);
CREATE INDEX idx_reports_campaign ON performance_reports(campaign_id);
CREATE INDEX idx_reports_period   ON performance_reports(period_start, period_end);

-- ============================================================
-- TABLE: channel_stats  [渠道粒度绩效]
-- ============================================================
CREATE TABLE channel_stats (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID            NOT NULL REFERENCES performance_reports(id) ON DELETE CASCADE,
    channel         channel_type    NOT NULL,
    ad_campaign_id  UUID            REFERENCES ad_campaigns(id),
    spend           DECIMAL(18,2)   NOT NULL DEFAULT 0,
    revenue         DECIMAL(18,2)   NOT NULL DEFAULT 0,
    impressions     BIGINT          NOT NULL DEFAULT 0,
    clicks          INTEGER         NOT NULL DEFAULT 0,
    conversions     INTEGER         NOT NULL DEFAULT 0,
    ctr             DECIMAL(10,6),
    roas            DECIMAL(10,4),
    UNIQUE (report_id, channel)
);

-- ============================================================
-- TABLE: variant_stats  [文案/素材归因绩效]
-- ============================================================
CREATE TABLE variant_stats (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID        NOT NULL REFERENCES performance_reports(id) ON DELETE CASCADE,
    copy_id         UUID        NOT NULL REFERENCES copies(id),
    asset_id        UUID        REFERENCES content_assets(id),
    spend           DECIMAL(18,2) NOT NULL DEFAULT 0,
    impressions     BIGINT      NOT NULL DEFAULT 0,
    clicks          INTEGER     NOT NULL DEFAULT 0,
    conversions     INTEGER     NOT NULL DEFAULT 0,
    ctr             DECIMAL(10,6),
    cvr             DECIMAL(10,6),
    roas            DECIMAL(10,4),
    attribution_weight DECIMAL(5,4),
    UNIQUE (report_id, copy_id, asset_id)
);
CREATE INDEX idx_variant_stats_report ON variant_stats(report_id);
CREATE INDEX idx_variant_stats_copy   ON variant_stats(copy_id);

-- ============================================================
-- TABLE: anomalies  [异常事件]
-- ============================================================
CREATE TABLE anomalies (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID        NOT NULL REFERENCES campaigns(id),
    report_id       UUID        REFERENCES performance_reports(id),
    channel         channel_type,
    metric          VARCHAR(50) NOT NULL,   -- 'cpm', 'ctr', 'roas'
    severity        VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    change_pct      DECIMAL(8,4),           -- 变化幅度
    description     TEXT,
    resolved        BOOLEAN     NOT NULL DEFAULT FALSE,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_anomalies_campaign ON anomalies(campaign_id);

-- ============================================================
-- TABLE: optimization_records  [优化循环记录]
-- ============================================================
CREATE TABLE optimization_records (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID            NOT NULL REFERENCES campaigns(id),
    report_id           UUID            NOT NULL REFERENCES performance_reports(id),
    loop_number         INTEGER         NOT NULL,
    status              opt_loop_status NOT NULL DEFAULT 'TRIGGERED',
    actions_taken       JSONB           NOT NULL DEFAULT '[]',
    effect_validated    BOOLEAN,
    kpi_before          JSONB,          -- 优化前 KPI 快照
    kpi_after           JSONB,          -- 优化后 KPI 快照
    learnings           TEXT,           -- 自然语言经验总结
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    validated_at        TIMESTAMPTZ,

    UNIQUE (campaign_id, loop_number)
);
CREATE INDEX idx_opt_records_campaign ON optimization_records(campaign_id);

-- ============================================================
-- TABLE: rules  [规则引擎配置]
-- ============================================================
CREATE TABLE rules (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    rule_type       VARCHAR(50)  NOT NULL CHECK (rule_type IN ('OPTIMIZER', 'REVIEW_GATE')),
    priority        INTEGER      NOT NULL DEFAULT 100,
    condition_json  JSONB        NOT NULL,
    action_json     JSONB        NOT NULL,
    cooldown_ms     BIGINT       NOT NULL DEFAULT 3600000,
    enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
    org_id          UUID         REFERENCES organizations(id),  -- NULL = 全局规则
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rules_type    ON rules(rule_type);
CREATE INDEX idx_rules_enabled ON rules(enabled);

-- ============================================================
-- TABLE: agent_memory  [Agent 长期记忆（结构化部分）]
-- ============================================================
CREATE TABLE agent_memory (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID        NOT NULL REFERENCES organizations(id),
    campaign_id     UUID        REFERENCES campaigns(id),
    memory_type     VARCHAR(50) NOT NULL,   -- 'CAMPAIGN_SUMMARY', 'OPTIMIZATION_LEARNING', etc.
    content         TEXT        NOT NULL,
    embedding       vector(1536),           -- 语义向量（pgvector）
    metadata        JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_memory_org      ON agent_memory(org_id);
CREATE INDEX idx_memory_campaign ON agent_memory(campaign_id);
CREATE INDEX idx_memory_type     ON agent_memory(memory_type);
CREATE INDEX idx_memory_vector   ON agent_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- TABLE: events  [领域事件安全存储（Outbox Pattern）]
-- ============================================================
CREATE TABLE domain_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(100) NOT NULL,
    version         VARCHAR(10)  NOT NULL DEFAULT '1.0',
    campaign_id     UUID,
    trace_id        VARCHAR(100),
    payload         JSONB        NOT NULL,
    published       BOOLEAN      NOT NULL DEFAULT FALSE,
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ
);
CREATE INDEX idx_events_unpublished ON domain_events(published) WHERE published = FALSE;
CREATE INDEX idx_events_campaign    ON domain_events(campaign_id);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_campaigns
    BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_copies
    BEFORE UPDATE ON copies
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_content_assets
    BEFORE UPDATE ON content_assets
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_ads
    BEFORE UPDATE ON ads
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
