"""
A2A Protocol Pydantic models — re-exported from app/schemas/a2a.py
for use within the protocol layer.
"""
from app.schemas.a2a import (
    AgentCard,
    AgentCapabilities,
    AgentSkill,
    AgentProvider,
    AgentAuthentication,
    Task,
    TaskStatus,
    TaskState,
    Message,
    TextPart,
    FilePart,
    DataPart,
    Artifact,
    SendTaskRequest,
    GetTaskResponse,
    CancelTaskRequest,
)

__all__ = [
    "AgentCard", "AgentCapabilities", "AgentSkill", "AgentProvider", "AgentAuthentication",
    "Task", "TaskStatus", "TaskState",
    "Message", "TextPart", "FilePart", "DataPart", "Artifact",
    "SendTaskRequest", "GetTaskResponse", "CancelTaskRequest",
]
