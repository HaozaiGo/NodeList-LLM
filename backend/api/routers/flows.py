import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Optional
from database import get_db
from models import Flow, User
from auth import get_current_user

router = APIRouter(prefix="/flows", tags=["flows"])


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

    model_config = {"from_attributes": True}


def _own_flow(flow_id: str, user: User, db: Session) -> Flow:
    flow = db.get(Flow, flow_id)
    if not flow or flow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Flow not found")
    return flow


@router.get("/", response_model=list[FlowOut])
def list_flows(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return db.query(Flow).filter(Flow.user_id == user.id).order_by(Flow.updated_at.desc(), Flow.created_at.desc()).all()


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
        flow.nodes = [n.model_dump() for n in body.nodes]
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
