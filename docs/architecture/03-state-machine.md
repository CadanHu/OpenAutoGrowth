# 业务状态机设计 — OpenAutoGrowth

> Version: 1.0 | Updated: 2026-04-08

本文档对系统中核心业务对象的**状态机**进行精确定义，明确每个状态的含义、合法转换路径及触发条件。

---

## 1. Campaign 状态机（最顶层）

Campaign 是系统中的核心聚合根，代表一次完整的增长投放活动。

```mermaid
stateDiagram-v2
    [*] --> DRAFT : 用户提交目标

    DRAFT --> PLANNING : Orchestrator 接收并开始规划
    
    PLANNING --> PENDING_REVIEW : Planner 生成 DAG 完成
    PLANNING --> PLANNING_FAILED : Planner 失败（超时/LLM错误）
    PLANNING_FAILED --> PLANNING : 重试 (max 3次)
    PLANNING_FAILED --> DRAFT : 超过重试次数，回退

    PENDING_REVIEW --> PRODUCTION : 审批通过（自动/人工）
    PENDING_REVIEW --> DRAFT : 审批拒绝，修改目标

    PRODUCTION --> DEPLOYED : 所有 Ad 在平台上线
    PRODUCTION --> PRODUCTION_FAILED : ChannelExec 失败
    PRODUCTION_FAILED --> PRODUCTION : 部分重试
    PRODUCTION_FAILED --> PAUSED : 无法恢复，人工接管

    DEPLOYED --> MONITORING : 开始数据采集
    
    MONITORING --> OPTIMIZING : Optimizer 触发优化动作
    OPTIMIZING --> MONITORING : 优化完成，继续监控
    OPTIMIZING --> LOOP_N : 触发新一轮闭环（N=循环次数）
    LOOP_N --> PLANNING : 重新规划

    MONITORING --> COMPLETED : Campaign 结束时间到达 OR KPI 达成
    OPTIMIZING --> COMPLETED : KPI 达成，自动收尾

    MONITORING --> PAUSED : 异常告警 OR 人工暂停
    PAUSED --> MONITORING : 人工恢复
    PAUSED --> COMPLETED : 人工终止

    COMPLETED --> [*]
```

### 状态说明表

| 状态 | 含义 | 允许的 Actor 操作 |
| :--- | :--- | :--- |
| `DRAFT` | 草稿，等待确认 | 用户可编辑目标/预算 |
| `PLANNING` | Planner 正在生成 DAG | 只读 |
| `PENDING_REVIEW` | 等待审批（素材+预算） | 人工可 Approve / Reject |
| `PRODUCTION` | 内容生产 + 渠道执行中 | 只读 |
| `DEPLOYED` | 广告已在平台上线 | 用户可查看实时数据 |
| `MONITORING` | 周期性数据采集中 | 用户可手动触发优化 |
| `OPTIMIZING` | Optimizer 正在执行调整 | 只读 |
| `LOOP_N` | 第 N 次闭环，重新规划 | 用户可中断循环 |
| `PAUSED` | 人工暂停 / 异常暂停 | 用户可 Resume / Stop |
| `COMPLETED` | 已结束，生成复盘报告 | 只读，可导出报告 |

---

## 2. Task 状态机（DAG 节点级别）

每个 DAG 中的 Task 节点有独立状态机，由 Orchestrator 管理。

```mermaid
stateDiagram-v2
    [*] --> PENDING : 创建时默认
    
    PENDING --> WAITING : 存在未完成的前置依赖
    WAITING --> PENDING : 依赖任务全部 DONE
    
    PENDING --> RUNNING : Orchestrator 调度，Agent 开始执行
    
    RUNNING --> DONE : Agent 返回成功结果
    RUNNING --> FAILED : Agent 返回错误 / 超时
    RUNNING --> SKIPPED : Orchestrator 判断该任务可跳过
    
    FAILED --> RUNNING : 重试（指数退避，max 3次）
    FAILED --> BLOCKED : 超过重试次数，阻塞后续任务
    
    BLOCKED --> RUNNING : 人工干预后恢复
    
    DONE --> [*]
    SKIPPED --> [*]
```

---

## 3. ContentAsset 状态机（素材级别）

对每一份文案/图片/视频素材的生命周期进行追踪。

```mermaid
stateDiagram-v2
    [*] --> GENERATING : Agent 开始生成

    GENERATING --> GENERATED : 生成成功
    GENERATING --> GEN_FAILED : 生成失败

    GENERATED --> REVIEWING : 进入审核队列
    REVIEWING --> APPROVED : 通过内容审核（安全/品牌）
    REVIEWING --> REJECTED : 未通过审核
    REJECTED --> GENERATING : 触发重新生成

    APPROVED --> UPLOADING : ChannelExec 上传至平台
    UPLOADING --> LIVE : 平台验收通过，素材上线
    UPLOADING --> UPLOAD_FAILED : 平台拒绝（违规/格式错误）
    UPLOAD_FAILED --> APPROVED : 修正后重新上传

    LIVE --> PAUSED : 被 Optimizer 暂停（效果差）
    LIVE --> REPLACED : 被新版本素材替换
    
    PAUSED --> LIVE : Optimizer 恢复
    PAUSED --> ARCHIVED : 最终归档

    REPLACED --> ARCHIVED
    LIVE --> ARCHIVED : Campaign 结束
    
    ARCHIVED --> [*]
```

---

## 4. OptimizationLoop 状态机（优化循环）

```mermaid
stateDiagram-v2
    [*] --> TRIGGERED : Analysis 报告触发 / 手动触发

    TRIGGERED --> ANALYZING : Optimizer 读取报告并分析
    
    ANALYZING --> DECISION_MADE : 确定优化动作
    ANALYZING --> NO_ACTION : 指标均正常，无需优化
    
    DECISION_MADE --> EXECUTING : 开始执行优化动作
    
    EXECUTING --> WAIT_EFFECT : 动作已执行，等待效果验证窗口（24h）
    
    WAIT_EFFECT --> EFFECT_VALIDATED : 效果数据回来，验证成功
    WAIT_EFFECT --> EFFECT_FAILED : 优化效果负向（ROI 更低）
    
    EFFECT_VALIDATED --> COMMITTED : 将优化经验写入 Memory
    EFFECT_FAILED --> ROLLBACK : 回滚优化动作
    
    COMMITTED --> [*]
    NO_ACTION --> [*]
    ROLLBACK --> [*]
```

---

## 5. 状态转换事件总览

| 事件名称 | 发送方 | 接收方 | 触发的主要状态变化 |
| :--- | :--- | :--- | :--- |
| `goal.submitted` | User | Orchestrator | Campaign: DRAFT → PLANNING |
| `plan.ready` | Planner | Orchestrator | Campaign: PLANNING → PENDING_REVIEW |
| `review.approved` | User / AutoReviewer | Orchestrator | Campaign: PENDING_REVIEW → PRODUCTION |
| `ad.deployed` | ChannelExec | Orchestrator | Campaign: PRODUCTION → DEPLOYED |
| `analysis.report_ready` | Analysis | Optimizer | Loop: TRIGGERED → ANALYZING |
| `optimizer.action_applied` | Optimizer | Orchestrator | Campaign: MONITORING → OPTIMIZING |
| `kpi.achieved` | Orchestrator | System | Campaign: * → COMPLETED |
| `anomaly.detected` | Analysis | Orchestrator | Campaign: MONITORING → PAUSED |
