"""
A2A Agent API — /v1/agents
Exposes each LangGraph agent as an A2A-compliant endpoint.
"""
import json
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.a2a import AgentCard, SendTaskRequest, Task, TaskState, TaskStatus

logger = structlog.get_logger(__name__)
router = APIRouter()

# ── AgentCard registry ────────────────────────────────────────────────────────

CARDS_DIR = Path(__file__).parent.parent / "protocols" / "a2a" / "cards"

AGENT_NAMES = [
    "planner", "strategy", "content_gen", "multimodal",
    "channel_exec", "analysis", "optimizer",
]


def _load_card(agent_name: str) -> AgentCard:
    card_file = CARDS_DIR / f"{agent_name}.json"
    if not card_file.exists():
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    return AgentCard(**json.loads(card_file.read_text()))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", summary="List all AgentCards")
async def list_agents():
    """Return AgentCards for all registered agents (A2A discovery)."""
    return {"agents": [_load_card(name).model_dump() for name in AGENT_NAMES]}


@router.get("/{agent_name}", response_model=AgentCard, summary="Get AgentCard")
async def get_agent_card(agent_name: str):
    """A2A service discovery — returns AgentCard for a specific agent."""
    return _load_card(agent_name)


@router.post("/{agent_name}/tasks/send", response_model=Task, summary="Send A2A Task")
async def send_task(agent_name: str, request: SendTaskRequest):
    """
    Receive an A2A Task, convert to LangGraph invocation via ARQ.

    Flow:
      1. Parse message.parts[0].text as JSON agent input
      2. Enqueue ARQ job for the specific agent node
      3. Return Task(state=submitted)
    """
    _load_card(agent_name)  # validate agent exists

    try:
        input_text = next(
            (p.text for p in request.message.parts if p.type == "text"), ""
        )
        agent_input = json.loads(input_text) if input_text else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="message.parts[0].text must be valid JSON")

    from app.tasks.agent_tasks import enqueue_agent_node
    job_id = await enqueue_agent_node(
        agent_name=agent_name,
        task_id=request.id,
        agent_input=agent_input,
    )

    logger.info("a2a_task_submitted", agent=agent_name, task_id=request.id, job_id=job_id)

    return Task(
        id=request.id,
        status=TaskStatus(state=TaskState.SUBMITTED),
        metadata={"job_id": job_id, "agent": agent_name},
    )


@router.get("/{agent_name}/tasks/{task_id}", response_model=Task, summary="Get A2A Task status")
async def get_task(agent_name: str, task_id: str):
    """Poll A2A Task status from Redis job store."""
    from app.tasks.agent_tasks import get_task_result
    result = await get_task_result(task_id)

    if result is None:
        return Task(
            id=task_id,
            status=TaskStatus(state=TaskState.WORKING),
        )

    if result.get("error"):
        return Task(
            id=task_id,
            status=TaskStatus(state=TaskState.FAILED),
            metadata={"error": result["error"]},
        )

    from app.schemas.a2a import Artifact, TextPart
    return Task(
        id=task_id,
        status=TaskStatus(state=TaskState.COMPLETED),
        artifacts=[
            Artifact(
                name="result",
                parts=[TextPart(text=json.dumps(result["output"]))],
            )
        ],
    )


@router.post("/{agent_name}/tasks/{task_id}/cancel", summary="Cancel A2A Task")
async def cancel_task(agent_name: str, task_id: str):
    """Request cancellation of a running A2A Task."""
    from app.tasks.agent_tasks import cancel_job
    cancelled = await cancel_job(task_id)
    state = TaskState.CANCELED if cancelled else TaskState.FAILED
    return Task(id=task_id, status=TaskStatus(state=state))
