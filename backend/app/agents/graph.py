"""
LangGraph StateGraph — campaign execution graph builder.

Wires all agent nodes into a DAG with:
  - Sequential edges for dependencies
  - Parallel fan-out (strategy → content_gen + multimodal simultaneously)
  - Conditional loop edge (optimizer → strategy | END)
"""
from langgraph.graph import StateGraph, END

from .state import CampaignState
from .planner import planner_node
from .strategy import strategy_node
from .content_gen import content_gen_node
from .multimodal import multimodal_node
from .channel_exec import channel_exec_node
from .analysis import analysis_node
from .optimizer import optimizer_node, should_loop


def build_campaign_graph(checkpointer=None):
    """
    Build and compile the campaign StateGraph.

    Args:
        checkpointer: LangGraph AsyncPostgresSaver instance for state persistence.
                      Pass None for in-memory (testing only).

    Returns:
        Compiled LangGraph application.

    Usage:
        async with get_checkpointer() as cp:
            graph = build_campaign_graph(cp)
            result = await graph.ainvoke(
                initial_state,
                config={"configurable": {"thread_id": campaign_id}}
            )
    """
    graph = StateGraph(CampaignState)

    # ── Register nodes ────────────────────────────────────────────
    graph.add_node("planner",      planner_node)
    graph.add_node("strategy",     strategy_node)
    graph.add_node("content_gen",  content_gen_node)
    graph.add_node("multimodal",   multimodal_node)
    graph.add_node("channel_exec", channel_exec_node)
    graph.add_node("analysis",     analysis_node)
    graph.add_node("optimizer",    optimizer_node)

    # ── Entry point ───────────────────────────────────────────────
    graph.set_entry_point("planner")

    # ── Sequential edges ──────────────────────────────────────────
    graph.add_edge("planner", "strategy")

    # ── Parallel fan-out: strategy → content_gen AND multimodal ──
    # LangGraph executes both nodes concurrently when both are listed as targets
    graph.add_edge("strategy", "content_gen")
    graph.add_edge("strategy", "multimodal")

    # ── Fan-in: both content_gen and multimodal must finish before channel_exec
    graph.add_edge("content_gen", "channel_exec")
    graph.add_edge("multimodal",  "channel_exec")

    # ── Continue pipeline ─────────────────────────────────────────
    graph.add_edge("channel_exec", "analysis")
    graph.add_edge("analysis",     "optimizer")

    # ── Conditional loop edge ─────────────────────────────────────
    graph.add_conditional_edges(
        "optimizer",
        should_loop,
        {
            "loop": "strategy",   # loop back for optimization
            "done": END,
        },
    )

    kwargs = {}
    if checkpointer is not None:
        kwargs["checkpointer"] = checkpointer

    return graph.compile(**kwargs)
