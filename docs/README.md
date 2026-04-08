# OpenAutoGrowth — 文档索引

本目录包含 OpenAutoGrowth 项目的全部规划、架构与业务建模文档。

## 📁 目录结构

```
docs/
├── architecture/                       # 系统架构文档
│   ├── 00-overview.md                  # 总体架构概览与 ADR
│   ├── 01-agent-design.md              # 8 个 Agent 的详细功能规范
│   ├── 02-system-flow.md               # 核心业务链路建模（时序图）
│   ├── 03-state-machine.md             # 业务状态机设计
│   ├── 04-agent-collaboration.md       # 智能体协作架构（协议/拓扑/熔断）
│   ├── 05-rule-engine.md               # 规则引擎设计（DSL/规则集/流程）
│   ├── 06-model-toolchain.md           # 模型工具链选型与成本估算
│   ├── 07-data-flow-service-boundary.md # 数据流与服务边界划分
│   └── 08-entity-state-flow.md         # 实体关系状态流转设计
│
└── business/                           # 业务建模文档
    ├── 01-domain-model.md              # DDD 领域建模（限界上下文/聚合根）
    └── 02-entity-relations.md          # 业务实体字段与 ER 关系定义
```

## 快速导航

### 🏗️ 架构文档

| 文档 | 核心内容 |
| :--- | :--- |
| [00 总体架构](./architecture/00-overview.md) | 四层架构、设计哲学、ADR 决策 |
| [01 Agent 设计](./architecture/01-agent-design.md) | 8 个 Agent 的职责、I/O 规范、决策规则 |
| [02 核心链路](./architecture/02-system-flow.md) | 端到端时序图、Phase 分解、降级策略 |
| [03 状态机](./architecture/03-state-machine.md) | Campaign/Task/Asset/OptLoop 状态机 |
| [04 Agent 协作](./architecture/04-agent-collaboration.md) | 协作模式、消息协议、熔断机制 |
| [05 规则引擎](./architecture/05-rule-engine.md) | 规则 DSL、内置规则集、执行流程 |
| [06 工具链选型](./architecture/06-model-toolchain.md) | LLM/视觉/广告/数据 工具链，成本估算 |
| [07 数据流边界](./architecture/07-data-flow-service-boundary.md) | 微服务拆分、事件 Schema、一致性策略 |
| [08 状态流转](./architecture/08-entity-state-flow.md) | 跨实体联动状态变更矩阵 |

### 💼 业务文档

| 文档 | 核心内容 |
| :--- | :--- |
| [01 领域建模](./business/01-domain-model.md) | DDD 五大限界上下文、聚合根、领域事件 |
| [02 实体关系](./business/02-entity-relations.md) | ER 图、9 张核心表字段规范、业务规则 |
