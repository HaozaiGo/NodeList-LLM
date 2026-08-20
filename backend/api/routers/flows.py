import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Optional
from database import get_db
from models import Flow, User
from auth import get_current_user

router = APIRouter(prefix="/flows", tags=["flows"])

IMAGE_ASSET_NODE_TYPES = {"characterAsset", "sceneAsset", "propAsset"}
ACTIVE_IMAGE_GENERATION_STATUSES = {"submitting", "submitted", "running", "timeout"}
IMAGE_GENERATION_STATE_KEYS = {
    "taskId",
    "generationStatus",
    "projectId",
    "taskCreatedAt",
    "imageTaskUpdatedAt",
}


class NodeSchema(BaseModel):
    id: str
    type: str
    position: dict[str, float]
    data: dict[str, Any]


class EdgeSchema(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None


class FlowCreate(BaseModel):
    name: str = "Untitled Flow"
    nodes: list[NodeSchema] = []
    edges: list[EdgeSchema] = []


class FlowUpdate(BaseModel):
    name: Optional[str] = None
    nodes: Optional[list[NodeSchema]] = None
    edges: Optional[list[EdgeSchema]] = None


class FlowOut(BaseModel):
    id: str
    name: str
    nodes: list[Any]
    edges: list[Any]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


def _own_flow(flow_id: str, user: User, db: Session) -> Flow:
    flow = db.get(Flow, flow_id)
    if not flow or flow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Flow not found")
    return flow


def _merge_server_image_generation_state(existing_nodes: list[Any], incoming_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    existing_by_id = {
        node.get("id"): node
        for node in existing_nodes
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }
    merged: list[dict[str, Any]] = []
    for node in incoming_nodes:
        if node.get("type") not in IMAGE_ASSET_NODE_TYPES:
            merged.append(node)
            continue

        existing = existing_by_id.get(node.get("id"))
        if not isinstance(existing, dict):
            merged.append(node)
            continue

        existing_data = existing.get("data")
        incoming_data = node.get("data")
        if not isinstance(existing_data, dict) or not isinstance(incoming_data, dict):
            merged.append(node)
            continue

        existing_config = existing_data.get("config")
        incoming_config = incoming_data.get("config")
        if not isinstance(existing_config, dict) or not isinstance(incoming_config, dict):
            merged.append(node)
            continue

        existing_task_id = str(existing_config.get("taskId") or "").strip()
        incoming_task_id = str(incoming_config.get("taskId") or "").strip()
        existing_status = str(existing_config.get("generationStatus") or "").lower()
        incoming_status = str(incoming_config.get("generationStatus") or "").lower()
        if not existing_task_id or incoming_task_id:
            merged.append(node)
            continue
        if existing_status not in ACTIVE_IMAGE_GENERATION_STATUSES:
            merged.append(node)
            continue
        if incoming_status and incoming_status not in {"submitting", "submitted"}:
            merged.append(node)
            continue

        protected_config = dict(incoming_config)
        for key in IMAGE_GENERATION_STATE_KEYS:
            if key in existing_config:
                protected_config[key] = existing_config[key]
        protected_data = dict(incoming_data)
        protected_data["config"] = protected_config
        if existing_data.get("status") in {"running", "queued"}:
            protected_data["status"] = existing_data.get("status")
        if isinstance(existing_data.get("metric"), str):
            protected_data["metric"] = existing_data["metric"]
        if isinstance(existing_data.get("items"), list):
            protected_data["items"] = existing_data["items"]
        merged.append({**node, "data": protected_data})

    return merged


@router.get("", response_model=list[FlowOut], include_in_schema=False)
@router.get("/", response_model=list[FlowOut])
def list_flows(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return db.query(Flow).filter(Flow.user_id == user.id).order_by(Flow.updated_at.desc(), Flow.created_at.desc()).all()


@router.post("", response_model=FlowOut, status_code=201, include_in_schema=False)
@router.post("/", response_model=FlowOut, status_code=201)
def create_flow(
    body: FlowCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    flow = Flow(
        id=str(uuid.uuid4()),
        name=body.name,
        nodes=[n.model_dump() for n in body.nodes],
        edges=[e.model_dump() for e in body.edges],
        user_id=user.id,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


@router.get("/{flow_id}", response_model=FlowOut)
def get_flow(
    flow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _own_flow(flow_id, user, db)


@router.put("/{flow_id}", response_model=FlowOut)
def update_flow(
    flow_id: str,
    body: FlowUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    flow = _own_flow(flow_id, user, db)
    if body.name is not None:
        flow.name = body.name
    if body.nodes is not None:
        flow.nodes = _merge_server_image_generation_state(flow.nodes or [], [n.model_dump() for n in body.nodes])
    if body.edges is not None:
        flow.edges = [e.model_dump() for e in body.edges]
    db.commit()
    db.refresh(flow)
    return flow


@router.delete("/{flow_id}", status_code=204)
def delete_flow(
    flow_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    flow = _own_flow(flow_id, user, db)
    db.delete(flow)
    db.commit()
