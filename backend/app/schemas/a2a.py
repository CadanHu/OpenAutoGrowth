"""
A2A Protocol Pydantic models.
Spec: https://a2a-protocol.org/latest/specification/
"""
from enum import Enum
from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class TaskState(str, Enum):
    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


class PartType(str, Enum):
    TEXT = "text"
    FILE = "file"
    DATA = "data"


# ── Message Parts ─────────────────────────────────────────────────────────────

class TextPart(BaseModel):
    type: str = "text"
    text: str


class FilePart(BaseModel):
    type: str = "file"
    file: dict  # { mimeType, uri | bytes }


class DataPart(BaseModel):
    type: str = "data"
    data: dict[str, Any]


# ── Message ───────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str = Field(..., pattern="^(user|agent)$")
    parts: list[TextPart | FilePart | DataPart]
    metadata: Optional[dict[str, Any]] = None


# ── Task ──────────────────────────────────────────────────────────────────────

class TaskStatus(BaseModel):
    state: TaskState
    message: Optional[Message] = None
    timestamp: Optional[str] = None


class Artifact(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parts: list[TextPart | FilePart | DataPart]
    index: int = 0
    append: Optional[bool] = None
    last_chunk: Optional[bool] = None


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: Optional[str] = None
    status: TaskStatus
    artifacts: Optional[list[Artifact]] = None
    history: Optional[list[Message]] = None
    metadata: Optional[dict[str, Any]] = None


# ── AgentCard ─────────────────────────────────────────────────────────────────

class AgentCapabilities(BaseModel):
    streaming: bool = False
    push_notifications: bool = False
    state_transition_history: bool = True


class AgentSkill(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    examples: Optional[list[str]] = None
    input_modes: Optional[list[str]] = None
    output_modes: Optional[list[str]] = None


class AgentAuthentication(BaseModel):
    schemes: list[str] = ["bearer"]
    credentials: Optional[str] = None


class AgentProvider(BaseModel):
    organization: str
    url: Optional[str] = None


class AgentCard(BaseModel):
    name: str
    description: str
    url: str
    version: str = "1.0.0"
    provider: Optional[AgentProvider] = None
    capabilities: AgentCapabilities = Field(default_factory=AgentCapabilities)
    authentication: Optional[AgentAuthentication] = None
    skills: list[AgentSkill] = []
    default_input_modes: list[str] = ["text"]
    default_output_modes: list[str] = ["text"]


# ── Request/Response ──────────────────────────────────────────────────────────

class SendTaskRequest(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: Optional[str] = None
    message: Message
    metadata: Optional[dict[str, Any]] = None


class GetTaskResponse(BaseModel):
    id: str
    result: Optional[Task] = None
    error: Optional[dict] = None


class CancelTaskRequest(BaseModel):
    id: str
    metadata: Optional[dict[str, Any]] = None
