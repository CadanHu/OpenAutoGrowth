# OpenAutoGrowth

> AI-driven, multi-agent growth engine that runs the full marketing lifecycle —
> **plan → produce → deploy → attribute → optimize** — on a closed loop.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Architecture](https://img.shields.io/badge/architecture-multi--agent-orange.svg)
![Frontend](https://img.shields.io/badge/frontend-Vite%20%7C%20vanilla%20JS-f7df1e.svg)
![Backend](https://img.shields.io/badge/backend-FastAPI%20%7C%20LangGraph-009688.svg)

---

## What it does

Define a goal (e.g. _"grow GitHub stars for this open-source project"_). Eight
specialized agents collaborate to decompose it, generate creative, deploy across
channels, attribute results, and apply autonomous corrections — then start the
next loop.

| Layer           | Agents                                          | Responsibility                          |
| :-------------- | :---------------------------------------------- | :-------------------------------------- |
| Intelligence    | Orchestrator · Planner                          | Lifecycle control · DAG planning        |
| Execution       | Strategy · ContentGen · Multimodal · ChannelExec| Copy/visual creation · channel deploy   |
| Feedback        | Analysis · Optimizer                            | Attribution · rule-based correction     |

---

## Repository layout

```
OpenAutoGrowth/
├── src/                 # Frontend: vanilla JS + Vite, hash router, cream design system
│   ├── agents/          #   In-browser agent simulators (run without backend)
│   ├── core/            #   EventBus, Memory, RuleEngine
│   ├── ui/              #   AppShell, router, pages (Hub, per-agent workbenches)
│   └── i18n/            #   zh / en locales
├── backend/             # FastAPI + LangGraph + Postgres/Redis (services under build)
├── database/            # Schema SQL (pgvector-enabled)
├── docs/                # SDD specs — see docs/README.md for the index
├── docker-compose.yml   # Postgres · Redis · Backend · ARQ worker · Frontend · pgAdmin
└── index.html           # Frontend entry
```

---

## Quick start

### Frontend only (no backend required)

The in-browser agent simulators let you drive the whole closed loop against
mocked channels — useful for UI work and demos.

```bash
npm install
npm run dev          # http://localhost:7373
```

### Full stack (Postgres + Redis + FastAPI + ARQ + Frontend)

```bash
docker compose up -d          # core services
docker compose --profile tools up -d    # + pgAdmin on :5050
```

Services:

| Service   | URL                     |
| :-------- | :---------------------- |
| Frontend  | http://localhost:7373   |
| Backend   | http://localhost:9393   |
| Postgres  | localhost:5432 (`oag` / `oag_pass`) |
| Redis     | localhost:6379          |
| pgAdmin   | http://localhost:5050   |

---

## Design system

The frontend ships with a warm cream palette (L0–L3 background stratification,
eight agent identity colors, Fraunces + Inter). Each agent has its own
workbench for focused iteration:

- `/` — **Hub**: orchestration canvas, status strip, agent summary grid, live events
- `/agents/content-gen` — ContentGen workbench (overview · **playground** · config · runs · prompt · logs)
- `/agents/optimizer` — Optimizer workbench (overview · **rules inspector** · config · runs · DSL · logs)
- `/agents/:id` — placeholder for agents whose workbench is still under construction

Full design spec: [`docs/frontend/01-design-system.md`](./docs/frontend/01-design-system.md).

---

## Documentation

All specs follow SDD (Spec-Driven Development) convention. See
[`docs/README.md`](./docs/README.md) for the complete index.

**Architecture** — system, agents, state machines, rule engine, data flow,
backend stack, API spec, LangGraph, A2A/MCP protocol, deployment.

**Frontend** — overview, design system, information architecture, routing,
Hub spec, per-agent workbench template.

**Business** — DDD domain model, entity relations.

Key entry points:

| Doc                                                                   | What's in it                                  |
| :-------------------------------------------------------------------- | :-------------------------------------------- |
| [architecture/00-overview](./docs/architecture/00-overview.md)        | Four-layer architecture + ADRs                |
| [architecture/01-agent-design](./docs/architecture/01-agent-design.md)| Per-agent responsibilities & I/O contracts    |
| [architecture/11-agent-langgraph](./docs/architecture/11-agent-langgraph.md) | LangGraph integration plan             |
| [frontend/00-overview](./docs/frontend/00-overview.md)                | Frontend architecture + frontend ADRs         |
| [frontend/05-agent-page-template](./docs/frontend/05-agent-page-template.md) | Skeleton shared by every agent page    |
| [business/01-domain-model](./docs/business/01-domain-model.md)        | DDD bounded contexts & aggregates             |

---

## Closed-loop flow

1. **Orchestrator** interprets the user goal and opens a Campaign.
2. **Planner** emits a dynamic task DAG.
3. **Strategy → ContentGen / Multimodal → ChannelExec** produce and deploy.
4. **Analysis** pulls attribution data and emits a performance report.
5. **Optimizer** evaluates the report against the rule engine and either triggers
   a new loop (rewrite / reallocate / scale) or halts.

See [`docs/architecture/02-system-flow.md`](./docs/architecture/02-system-flow.md)
for sequence diagrams and failure/degradation paths.

---

## Tech stack

**Frontend** — Vite 6, vanilla JS, CSS custom properties (Design Tokens),
zero-dependency hash router, inline SVG icon set, i18n (zh / en).

**Backend** — FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, LangGraph,
Anthropic SDK, Redis + ARQ workers, MCP protocol client.

**Infrastructure** — PostgreSQL 15 with pgvector, Redis 7, Docker Compose.

---

## Status

| Surface                              | State                                   |
| :----------------------------------- | :-------------------------------------- |
| Frontend Hub + Launch flow           | Shipped (v0.1)                          |
| ContentGen / Optimizer workbenches   | Shipped (v0.2)                          |
| Remaining 6 agent workbenches        | Placeholder pages; rollout in progress  |
| Backend FastAPI scaffold             | Bootstrapped                            |
| LangGraph-backed orchestrator        | In progress                             |

Contributions, issues and discussions welcome — open a PR or issue on GitHub.
