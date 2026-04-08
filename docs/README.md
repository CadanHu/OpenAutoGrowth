# OpenAutoGrowth — 文档索引

本目录包含 OpenAutoGrowth 项目的全部规划、架构与业务建模文档。

## 📁 目录结构

```
docs/
├── architecture/                   # 系统架构文档
│   ├── 00-overview.md              # 总体架构概览
│   ├── 01-agent-design.md          # 多Agent详细功能设计
│   ├── 02-system-flow.md           # 系统核心流程链路
│   └── 03-state-machine.md         # 业务状态机设计
│
└── business/                       # 业务建模文档
    ├── 01-domain-model.md           # 核心业务领域建模
    └── 02-entity-relations.md       # 业务实体与关系定义
```

## 快速导航

| 文档 | 说明 |
| --- | --- |
| [总体架构概览](./architecture/00-overview.md) | 系统分层结构、设计哲学、技术选型 |
| [Agent 功能设计](./architecture/01-agent-design.md) | 8 个 Agent 的职责、输入/输出规范 |
| [核心流程链路](./architecture/02-system-flow.md) | 从用户目标到闭环优化的完整流程 |
| [业务状态机](./architecture/03-state-machine.md) | Campaign、任务、内容资产等状态机 |
| [领域建模](./business/01-domain-model.md) | DDD 领域划分与聚合根设计 |
| [业务实体与关系](./business/02-entity-relations.md) | ER图、核心实体字段、关系定义 |
