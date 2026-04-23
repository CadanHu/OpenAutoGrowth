# 11 — LangGraph Agent 设计

> Version: 1.0 | Date: 2026-04-09

## 1. 整体映射关系

```
Orchestrator.js (前端模拟)        →    LangGraph StateGraph (后端生产)
──────────────────────────────────────────────────────────────────────
registerAgent(name, agent)        →    graph.add_node(name, node_fn)
task.dependencies = ['t1','t2']   →    graph.add_edge(src, dst)
parallel_group = 'gen'            →    Send() fan-out + fan-in
memory.save/get                   →    CampaignState TypedDict 字段
EventBus.publish(event)           →    Redis Pub/Sub (core/event_bus.py)
RuleEngine.evaluate(ctx)          →    Conditional edge / interrupt
campaign.status 状态机            →    graph.add_conditional_edges()
```

---

## 2. CampaignState — 全局共享状态

```python
# app/agents/state.py
from typing import TypedDict, Optional, Any
from langgraph.graph.message import add_messages

class CampaignState(TypedDict):
    # ── 输入 ─────────────────────────────────────
    campaign_id:   str
    goal:          str
    budget:        dict          # { total, currency, daily_cap }
    kpi:           dict          # { metric, target }
    constraints:   dict          # { channels[], region }

    # ── 规划层输出 ────────────────────────────────
    plan:          Optional[dict]      # Planner 输出的 DAG Plan
    scenario:      Optional[str]       # NEW_PRODUCT / RETENTION / ...

    # ── 执行层中间产物 ────────────────────────────
    strategy:      Optional[dict]      # StrategyAgent 输出
    content:       Optional[dict]      # ContentGenAgent 输出
    assets:        Optional[dict]      # MultimodalAgent 输出
    deployed_ads:  Optional[dict]      # ChannelExecAgent 输出

    # ── 反馈层产物 ────────────────────────────────
    report:        Optional[dict]      # AnalysisAgent 输出
    anomalies:     Optional[list]
    opt_actions:   Optional[list]      # OptimizerAgent 决策

    # ── 控制流 ────────────────────────────────────
    status:        str                 # 当前 Campaign 状态
    loop_count:    int                 # 优化闭环次数
    errors:        list[dict]          # 节点错误记录
    completed_tasks: list[str]         # 已完成任务 ID
```

---

## 3. DAG 图结构（NEW_PRODUCT 场景）

```
START
  │
  ▼
[planner]          # 场景检测 + 生成任务列表
  │
  ▼
[strategy]         # 渠道评分 + 预算分配
  │
  ├──────────────────────────────────┐
  ▼                                  ▼
[content_gen]                  [multimodal]      ← 并行 (parallel_group: gen)
  │                                  │
  └──────────────┬───────────────────┘
                 ▼
          [channel_exec]       # 多平台投放
                 │
                 ▼
           [analysis]          # 数据拉取 + 归因
                 │
                 ▼
           [optimizer]         # RuleEngine 决策
                 │
         ┌───────┴───────┐
         ▼               ▼
    [END/DONE]     [loop_back]   # 若 loop_count < 5 且 ROAS 未达标
                        │
                        └──→ [strategy]  (闭环)
```

---

## 4. 图构建代码骨架

```python
# app/agents/graph.py
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from .state import CampaignState
from .planner import planner_node
from .strategy import strategy_node
from .content_gen import content_gen_node
from .multimodal import multimodal_node
from .channel_exec import channel_exec_node
from .analysis import analysis_node
from .optimizer import optimizer_node, should_loop

def build_campaign_graph(checkpointer: AsyncPostgresSaver) -> StateGraph:
    graph = StateGraph(CampaignState)

    # 注册节点
    graph.add_node("planner",      planner_node)
    graph.add_node("strategy",     strategy_node)
    graph.add_node("content_gen",  content_gen_node)
    graph.add_node("multimodal",   multimodal_node)
    graph.add_node("channel_exec", channel_exec_node)
    graph.add_node("analysis",     analysis_node)
    graph.add_node("optimizer",    optimizer_node)

    # 主链路边
    graph.set_entry_point("planner")
    graph.add_edge("planner",      "strategy")
    graph.add_edge("strategy",     "content_gen")
    graph.add_edge("strategy",     "multimodal")    # 并行 fan-out
    graph.add_edge("content_gen",  "channel_exec")
    graph.add_edge("multimodal",   "channel_exec")  # 并行 fan-in
    graph.add_edge("channel_exec", "analysis")
    graph.add_edge("analysis",     "optimizer")

    # 优化闭环条件边
    graph.add_conditional_edges(
        "optimizer",
        should_loop,                  # 返回 "loop" 或 "done"
        { "loop": "strategy", "done": END }
    )

    return graph.compile(checkpointer=checkpointer)
```

---

## 5. 节点函数签名规范

每个节点函数接收 `CampaignState`，返回状态的**部分更新**（LangGraph 自动 merge）：

```python
# app/agents/planner.py
async def planner_node(state: CampaignState) -> dict:
    """
    输入:  state.goal, state.budget, state.kpi, state.constraints
    输出:  { "plan": Plan, "scenario": str, "status": "PLANNING" }
    事件:  PlanGenerated
    """
    ...
    return {
        "plan": plan,
        "scenario": scenario,
        "status": "PLANNING",
        "completed_tasks": state["completed_tasks"] + ["planner"],
    }
```

---

## 6. Checkpoint — Agent 状态持久化

```python
# app/database.py (片段)
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

async def get_checkpointer() -> AsyncPostgresSaver:
    # 复用已有 PostgreSQL 连接，写入 agent_memory 表
    return AsyncPostgresSaver.from_conn_string(settings.DATABASE_URL)
```

**LangGraph 自动管理：**
- 每个节点执行后 checkpoint 写入 DB
- 进程崩溃后可从最后 checkpoint 恢复
- `thread_id = campaign_id` — 每个 Campaign 独立状态线程

---

## 7. 并行执行实现（content_gen + multimodal）

```python
# app/agents/graph.py (片段)
from langgraph.types import Send

def dispatch_parallel(state: CampaignState) -> list[Send]:
    """strategy 完成后，并行触发 content_gen 和 multimodal"""
    return [
        Send("content_gen", state),
        Send("multimodal",  state),
    ]

graph.add_conditional_edges("strategy", dispatch_parallel)
```

---

## 8. 闭环条件逻辑

```python
# app/agents/optimizer.py (片段)
def should_loop(state: CampaignState) -> str:
    """
    决定是否进入下一轮优化循环
    条件：loop_count < 5 AND (ROAS 未达标 OR 有高优先级优化动作)
    """
    if state["loop_count"] >= 5:
        return "done"
    roas = state["report"]["metrics"].get("roas", 0)
    target = state["kpi"]["target"]
    if roas >= target:
        return "done"
    return "loop"
```

---

## 9. 错误处理策略

| 场景 | 处理方式 |
|------|---------|
| 节点抛出异常 | 写入 `state.errors`，状态置 FAILED，停止 DAG |
| LLM API 超时 | 指数退避重试 3 次（由 `tenacity` 装饰器处理） |
| 渠道 API 失败 | 该渠道跳过（SKIPPED），其他渠道继续 |
| Checkpoint 恢复 | LangGraph 自动从最后成功节点重放 |
| 闭环超限 | loop_count >= 5 强制终止，状态置 COMPLETED |
