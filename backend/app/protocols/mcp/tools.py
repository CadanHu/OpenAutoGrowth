"""
MCP Tool definitions — exposed to Claude via Anthropic tool_use API.
Each tool maps to a callable handler function.

Usage in agent nodes:
    from app.protocols.mcp.tools import MCP_TOOLS, dispatch_tool

    response = await client.messages.create(
        model=settings.anthropic_model,
        tools=MCP_TOOLS,
        messages=[...],
    )
    if response.stop_reason == "tool_use":
        for block in response.content:
            if block.type == "tool_use":
                result = await dispatch_tool(block.name, block.input, db=db)
"""
from typing import Any
import structlog

logger = structlog.get_logger(__name__)

MCP_TOOLS = [
    {
        "name": "db_get_campaign",
        "description": "从 PostgreSQL 查询 Campaign 详情（含 KPI、预算、状态）",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string", "description": "Campaign UUID"}
            },
            "required": ["campaign_id"],
        },
    },
    {
        "name": "db_save_content_bundle",
        "description": "保存 ContentBundle（含文案变体）到数据库",
        "input_schema": {
            "type": "object",
            "properties": {
                "campaign_id": {"type": "string"},
                "variants":    {"type": "array", "items": {"type": "object"}},
                "llm_model":   {"type": "string"},
            },
            "required": ["campaign_id", "variants"],
        },
    },
    {
        "name": "ad_api_deploy",
        "description": "调用广告平台 API 创建并投放广告（Meta / TikTok / Google）",
        "input_schema": {
            "type": "object",
            "properties": {
                "platform":  {"type": "string", "enum": ["meta", "tiktok", "google"]},
                "ad_config": {"type": "object", "description": "Platform-specific ad config"},
            },
            "required": ["platform", "ad_config"],
        },
    },
    {
        "name": "ad_api_pull_metrics",
        "description": "从广告平台拉取最新 CTR / ROAS / CVR 等指标",
        "input_schema": {
            "type": "object",
            "properties": {
                "platform":    {"type": "string", "enum": ["meta", "tiktok", "google"]},
                "ad_ids":      {"type": "array", "items": {"type": "string"}},
                "date_range":  {"type": "object", "properties": {
                    "from": {"type": "string"}, "to": {"type": "string"}
                }},
            },
            "required": ["platform", "ad_ids"],
        },
    },
    {
        "name": "vector_search_memory",
        "description": "在历史优化记忆中语义检索相似经验（pgvector cosine similarity）",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Natural language query"},
                "top_k": {"type": "integer", "default": 3, "minimum": 1, "maximum": 10},
            },
            "required": ["query"],
        },
    },
]


async def dispatch_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    db=None,
) -> Any:
    """
    Route MCP tool_use calls to their handler functions.
    Called by agent nodes after receiving a tool_use stop reason from Claude.
    """
    logger.info("mcp_tool_call", tool=tool_name)

    match tool_name:
        case "db_get_campaign":
            return await _db_get_campaign(tool_input["campaign_id"], db)
        case "db_save_content_bundle":
            return await _db_save_content_bundle(tool_input, db)
        case "ad_api_deploy":
            return await _ad_api_deploy(tool_input)
        case "ad_api_pull_metrics":
            return await _ad_api_pull_metrics(tool_input)
        case "vector_search_memory":
            return await _vector_search_memory(tool_input, db)
        case _:
            raise ValueError(f"Unknown MCP tool: {tool_name}")


# ── Tool Handlers ─────────────────────────────────────────────────────────────

async def _db_get_campaign(campaign_id: str, db) -> dict:
    if db is None:
        return {}
    from sqlalchemy import select
    from app.models.campaign import Campaign
    result = await db.get(Campaign, campaign_id)
    if not result:
        return {"error": "not_found"}
    return {"id": str(result.id), "goal": result.goal, "status": result.status}


async def _db_save_content_bundle(input_: dict, db) -> dict:
    # TODO: implement DB write
    return {"bundle_id": "stub", "saved": True}


async def _ad_api_deploy(input_: dict) -> dict:
    # TODO: call platform SDK
    return {"status": "stub_deployed", "platform": input_["platform"]}


async def _ad_api_pull_metrics(input_: dict) -> dict:
    # TODO: call platform reporting API
    return {"ctr": 0.03, "roas": 2.8, "stub": True}


async def _vector_search_memory(input_: dict, db) -> list[dict]:
    from app.core.memory import memory_system
    return await memory_system.get_similar(input_["query"], input_.get("top_k", 3), db)
