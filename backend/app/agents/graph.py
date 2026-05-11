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
from .human_gate import (
    gate_before_content_gen,
    gate_before_reviewer,
    gate_before_channel_exec,
    gate_before_optimizer,
    gate_decision,
)


def should_publish(state: CampaignState) -> str:
    """Conditional edge: pass to execution if approved, else loop back to strategy."""
    if state.get("review_result") == "APPROVED":
        return "publish"
    return "revise"


async def _post_finance_gate(state: CampaignState) -> dict:
    """No-op pass-through. Exists so the gate's `proceed` branch can fan out
    to the parallel content_gen + multimodal pair via static edges (conditional
    edges only route to a single node)."""
    return {}


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
    graph.add_node("planner_node",            planner_node)
    graph.add_node("strategy_node",           strategy_node)
    graph.add_node("gate_before_content_gen",  gate_before_content_gen)
    graph.add_node("post_finance_gate",        _post_finance_gate)
    graph.add_node("content_gen_node",         content_gen_node)
    graph.add_node("multimodal_node",          multimodal_node)
    graph.add_node("gate_before_reviewer",     gate_before_reviewer)
    graph.add_node("reviewer_node",            reviewer_node)
    graph.add_node("gate_before_channel_exec", gate_before_channel_exec)
    graph.add_node("channel_exec_node",        channel_exec_node)
    graph.add_node("analysis_node",            analysis_node)
    graph.add_node("gate_before_optimizer",    gate_before_optimizer)
    graph.add_node("optimizer_node",           optimizer_node)

    # ── Entry point ───────────────────────────────────────────────
    graph.set_entry_point("planner_node")

    # ── Sequential edges ──────────────────────────────────────────
    graph.add_edge("planner_node", "strategy_node")

    # ── Strategy → human gate → parallel content_gen + multimodal ──
    # The gate checks GovernanceRules for stage=content_gen (e.g. the
    # finance_high_budget rule). If any fire, it opens a RevisionCase and
    # PAUSES the campaign; the worker exits cleanly via END until an
    # approval REST call re-enqueues the run.
    graph.add_edge("strategy_node", "gate_before_content_gen")
    graph.add_conditional_edges(
        "gate_before_content_gen",
        gate_decision,
        {
            "proceed": "post_finance_gate",
            "pause":   END,
            "revise":  "strategy_node",
        },
    )
    # Fan-out to the parallel branch happens AFTER the gate.
    graph.add_edge("post_finance_gate", "content_gen_node")
    graph.add_edge("post_finance_gate", "multimodal_node")

    # ── Fan-in: both content_gen and multimodal finish before the BRAND
    # gate. The gate is between creative production and the reviewer so
    # brand sign-off happens BEFORE the LLM reviewer's automated pass.
    graph.add_edge("content_gen_node", "gate_before_reviewer")
    graph.add_edge("multimodal_node",  "gate_before_reviewer")

    graph.add_conditional_edges(
        "gate_before_reviewer",
        gate_decision,
        {
            "proceed": "reviewer_node",
            "pause":   END,
            "revise":  "strategy_node",
        },
    )

    # ── Conditional review edge: APPROVED → channel-exec gate (LEGAL et al.)
    graph.add_conditional_edges(
        "reviewer_node",
        should_publish,
        {
            "publish": "gate_before_channel_exec",
            "revise":  "strategy_node",    # loop back to fix errors
        },
    )

    # ── LEGAL / compliance gate before deploying to channels ──────
    graph.add_conditional_edges(
        "gate_before_channel_exec",
        gate_decision,
        {
            "proceed": "channel_exec_node",
            "pause":   END,
            "revise":  "strategy_node",
        },
    )

    # ── Continue pipeline ─────────────────────────────────────────
    graph.add_edge("channel_exec_node", "analysis_node")
    graph.add_edge("analysis_node",     "gate_before_optimizer")

    # ── MARKETING_DIRECTOR gate before optimizer loop ─────────────
    # Fires on rules like loop_count_gte=2, kpi_met=false — keeps a human
    # in the loop on persistent under-performance before the optimizer
    # auto-adjusts spend again.
    graph.add_conditional_edges(
        "gate_before_optimizer",
        gate_decision,
        {
            "proceed": "optimizer_node",
            "pause":   END,
            "revise":  "strategy_node",
        },
    )

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
