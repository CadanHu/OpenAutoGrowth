# OpenAutoGrowth 🚀

**OpenAutoGrowth** is an AI-driven, multi-agent growth engine that automates the entire marketing lifecycle through a closed-loop system.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Architecture](https://img.shields.io/badge/architecture-Multi--Agent-orange.svg)

## 🌟 Key Features
- **Intelligent Orchestration**: High-level goal interpretation and dynamic task scheduling.
- **Multi-Agent Collaboration**: Specialized agents for Copywriting, Multimodal Assets (Image/Video), Strategy, and Execution.
- **Closed-Loop Optimization**: Autonomous performance analysis and strategy correction.
- **Modern UI**: Premium Glassmorphism dashboard for real-time monitoring.

## 🏗️ Architecture
The system follows a **Layered + Multi-Agent + Dynamic Orchestration** design. 
All design specifications live in the [`/docs`](./docs/README.md) directory:

| Document | Description |
| :--- | :--- |
| [System Overview](./docs/architecture/00-overview.md) | Architecture layers, ADR decisions |
| [Agent Design](./docs/architecture/01-agent-design.md) | 8 Agents' functions, I/O specs |
| [System Flow](./docs/architecture/02-system-flow.md) | Core pipeline, sequence diagrams |
| [State Machine](./docs/architecture/03-state-machine.md) | Campaign, Task, Asset states |
| [Domain Model](./docs/business/01-domain-model.md) | DDD bounded contexts & aggregates |
| [Entity Relations](./docs/business/02-entity-relations.md) | ER diagram & field definitions |

### System Flow
1. **User Goal** → Interpreted by **Orchestrator**.
2. **Planner** creates a dynamic **Task DAG**.
3. **Execution Agents** generate content and deploy to channels.
4. **Data Analysis Agent** pulls results.
5. **Optimizer Agent** refines the strategy and triggers a new cycle.

## 🚀 Getting Started
1. **Clone the repo**:
   ```bash
   git clone https://github.com/CadanHu/OpenAutoGrowth.git
   cd OpenAutoGrowth
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Run local dashboard**:
   ```bash
   npm run dev
   ```

## 🛠️ Tech Stack
- **Framework**: Vite + Vanilla JS (Agent Logic)
- **Styling**: Vanilla CSS (Rich Aesthetics)
- **Intelligence**: Multi-Agent Orchestration (inspired by LangGraph/AutoGen)

---
Developed by **Antigravity AI** for **CadanHu**.
