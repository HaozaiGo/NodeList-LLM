from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models import Flow, User
from auth import get_current_user
from executor.graph import run_flow_stream

router = APIRouter(prefix="/playground", tags=["playground"])


class RunRequest(BaseModel):
    message: str


async def _event_generator(flow_dict: dict, message: str):
    try:
        async for token in run_flow_stream(flow_dict, message):
            yield f"data: {token}\n\n"
    except Exception as e:
        yield f"data: [ERROR] {e}\n\n"
    yield "data: [DONE]\n\n"


@router.post("/{flow_id}/run")
async def run_flow(
    flow_id: str,
    body: RunRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    flow = db.get(Flow, flow_id)
    if not flow or flow.user_id != user.id:
        raise HTTPException(status_code=404, detail="Flow not found")

    flow_dict = {
        "nodes": flow.nodes,
        "edges": flow.edges,
    }

    return StreamingResponse(
        _event_generator(flow_dict, body.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
