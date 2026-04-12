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
from .reviewer import reviewer_node
from .channel_exec import channel_exec_node
from .analysis import analysis_node
from .optimizer import optimizer_node, should_loop


def should_publish(state: CampaignState) -> str:
    """Conditional edge: pass to execution if approved, else loop back to strategy."""
    if state.get("review_result") == "APPROVED":
        return "publish"
    return "revise"


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
    graph.add_node("planner_node",      planner_node)
    graph.add_node("strategy_node",     strategy_node)
    graph.add_node("content_gen_node",  content_gen_node)
    graph.add_node("multimodal_node",   multimodal_node)
    graph.add_node("reviewer_node",     reviewer_node)
    graph.add_node("channel_exec_node", channel_exec_node)
    graph.add_node("analysis_node",     analysis_node)
    graph.add_node("optimizer_node",    optimizer_node)

    # ── Entry point ───────────────────────────────────────────────
    graph.set_entry_point("planner_node")

    # ── Sequential edges ──────────────────────────────────────────
    graph.add_edge("planner_node", "strategy_node")

    # ── Parallel fan-out: strategy → content_gen AND multimodal ──
    # LangGraph executes both nodes concurrently when both are listed as targets
    graph.add_edge("strategy_node", "content_gen_node")
    graph.add_edge("strategy_node", "multimodal_node")

    # ── Fan-in: both content_gen and multimodal must finish before review
    graph.add_edge("content_gen_node", "reviewer_node")
    graph.add_edge("multimodal_node",  "reviewer_node")

    # ── Conditional review edge ──
    graph.add_conditional_edges(
        "reviewer_node",
        should_publish,
        {
            "publish": "channel_exec_node",
            "revise":  "strategy_node",    # loop back to fix errors
        },
    )

    # ── Continue pipeline ─────────────────────────────────────────
    graph.add_edge("channel_exec_node", "analysis_node")
    graph.add_edge("analysis_node",     "optimizer_node")

    # ── Conditional loop edge ─────────────────────────────────────
    graph.add_conditional_edges(
        "optimizer_node",
        should_loop,
        {
            "loop_strategy": "strategy_node",     # Change budget/channel mix
            "loop_content":  "content_gen_node",   # Rewrite copy/refresh creative
            "loop_exec":     "channel_exec_node",  # Just push bid/pause updates
            "done":          END,
        },
    )

    kwargs = {}
    if checkpointer is not None:
        kwargs["checkpointer"] = checkpointer

    return graph.compile(**kwargs)
