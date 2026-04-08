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
Detailed design specifications can be found in [ARCHITECTURE_DESIGN.md](./ARCHITECTURE_DESIGN.md).

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
