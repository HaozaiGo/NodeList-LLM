import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_admin
from billing import get_billing_config
from database import get_db
from models import Asset, CreditTransaction, Flow, User

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminUserOut(BaseModel):
    id: str
    email: str
    role: str
    credit_balance: int
    disabled: bool
    created_at: Optional[datetime] = None
    flows: int
    assets: int


class AdminUserPageOut(BaseModel):
    items: list[AdminUserOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminFlowSummaryOut(BaseModel):
    id: str
    name: str
    node_count: int
    edge_count: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AdminSummaryOut(BaseModel):
    users: int
    active_users: int
    disabled_users: int
    total_credits: int
    flows: int
    assets: int


class AdminUserUpdate(BaseModel):
    role: Optional[str] = Field(default=None, pattern="^(user|admin)$")
    disabled: Optional[bool] = None


class CreditAdjustRequest(BaseModel):
    amount: int = Field(..., description="Positive to recharge, negative to deduct")
    note: str = ""
    transaction_type: str = "manual_adjustment"


class CreditTransactionOut(BaseModel):
    id: str
    user_id: str
    user_email: str
    admin_id: Optional[str] = None
    admin_email: Optional[str] = None
    amount: int
    balance_after: int
    transaction_type: str
    note: str
    created_at: Optional[datetime] = None


class CreditAdjustResponse(BaseModel):
    user: AdminUserOut
    transaction: CreditTransactionOut


class BillingConfigOut(BaseModel):
    image_cost: int
    video_cost: int
    updated_at: Optional[datetime] = None


class BillingConfigUpdate(BaseModel):
    image_cost: int = Field(..., ge=0, le=1_000_000)
    video_cost: int = Field(..., ge=0, le=1_000_000)


class AdminModelRunOut(BaseModel):
    user_id: str
    user_email: str
    flow_id: str
    flow_name: str
    node_id: str
    node_type: str
    node_label: str
    kind: str
    provider: str
    model: str
    status: str
    task_id: str
    started_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    stale: bool


ACTIVE_MODEL_RUN_STATUSES = {
    "submitting",
    "submitted",
    "pending",
    "queued",
    "in_queue",
    "running",
    "processing",
    "generating",
    "streaming",
    "polling_retry",
    "timeout",
}
MODEL_RUN_STALE_AFTER = timedelta(minutes=10)


def _node_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _node_text(value: Any) -> str:
    return str(value or "").strip()


def _node_datetime(*values: Any) -> Optional[datetime]:
    for value in values:
        if isinstance(value, datetime):
            return value
        text_value = _node_text(value)
        if not text_value:
            continue
        try:
            return datetime.fromisoformat(text_value.replace("Z", "+00:00"))
        except ValueError:
            continue
    return None


def _aware_datetime(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _model_run_kind(node_type: str) -> str:
    if node_type == "videoGeneration":
        return "video"
    if node_type in {"characterAsset", "sceneAsset", "propAsset"}:
        return "image"
    return "text"


def _model_run_provider(kind: str, model: str, task_id: str) -> str:
    normalized_model = model.lower()
    normalized_task_id = task_id.lower()
    if normalized_task_id.startswith(("lovart:", "lovart-batch:")) or kind == "image":
        return "Lovart"
    if normalized_task_id.startswith("wan:") or normalized_model.startswith("wan"):
        return "MuleRouter"
    if normalized_task_id.startswith("bds-pro:") or normalized_model == "bds-pro":
        return "BDS"
    if normalized_model.startswith("qwen"):
        return "DashScope"
    if normalized_model.startswith("doubao"):
        return "Volcengine"
    return "Lovart" if kind == "video" and normalized_model.startswith("seedance-2") else "Other"


def _extract_model_runs(
    flow: Flow,
    user: User,
    *,
    now: Optional[datetime] = None,
) -> list[AdminModelRunOut]:
    runs: list[AdminModelRunOut] = []
    current_time = _aware_datetime(now or datetime.now(timezone.utc))
    flow_updated_at = _node_datetime(flow.updated_at)
    stale = flow_updated_at is None or current_time - _aware_datetime(flow_updated_at) > MODEL_RUN_STALE_AFTER

    for raw_node in flow.nodes or []:
        node = _node_dict(raw_node)
        data = _node_dict(node.get("data"))
        config = _node_dict(data.get("config"))
        run_status = _node_text(config.get("generationStatus") or config.get("status")).lower()
        if run_status not in ACTIVE_MODEL_RUN_STATUSES:
            continue

        node_type = _node_text(node.get("type"))
        model = _node_text(config.get("model"))
        task_id = _node_text(config.get("taskId"))
        if not model and not task_id:
            continue
        kind = _model_run_kind(node_type)
        started_at = _node_datetime(
            config.get("taskCreatedAt"),
            config.get("submittedAt"),
            config.get("imageTaskUpdatedAt"),
            flow.created_at,
        )
        runs.append(
            AdminModelRunOut(
                user_id=user.id,
                user_email=user.email,
                flow_id=flow.id,
                flow_name=flow.name,
                node_id=_node_text(node.get("id")),
                node_type=node_type,
                node_label=_node_text(data.get("label")) or node_type,
                kind=kind,
                provider=_model_run_provider(kind, model, task_id),
                model=model or "Unknown",
                status=run_status,
                task_id=task_id,
                started_at=started_at,
                updated_at=flow_updated_at,
                stale=stale,
            )
        )
    return runs


def _user_out(db: Session, user: User) -> AdminUserOut:
    flow_count = db.query(func.count(Flow.id)).filter(Flow.user_id == user.id).scalar() or 0
    asset_count = db.query(func.count(Asset.id)).filter(Asset.user_id == user.id).scalar() or 0
    return AdminUserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        credit_balance=user.credit_balance,
        disabled=user.disabled_at is not None,
        created_at=user.created_at,
        flows=flow_count,
        assets=asset_count,
    )


def _transaction_out(db: Session, transaction: CreditTransaction) -> CreditTransactionOut:
    user = db.get(User, transaction.user_id)
    admin = db.get(User, transaction.admin_id) if transaction.admin_id else None
    return CreditTransactionOut(
        id=transaction.id,
        user_id=transaction.user_id,
        user_email=user.email if user else "",
        admin_id=transaction.admin_id,
        admin_email=admin.email if admin else None,
        amount=transaction.amount,
        balance_after=transaction.balance_after,
        transaction_type=transaction.transaction_type,
        note=transaction.note,
        created_at=transaction.created_at,
    )


@router.get("/summary", response_model=AdminSummaryOut)
def summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    users = db.query(func.count(User.id)).scalar() or 0
    disabled_users = db.query(func.count(User.id)).filter(User.disabled_at.isnot(None)).scalar() or 0
    total_credits = db.query(func.coalesce(func.sum(User.credit_balance), 0)).scalar() or 0
    flows = db.query(func.count(Flow.id)).scalar() or 0
    assets = db.query(func.count(Asset.id)).scalar() or 0
    return AdminSummaryOut(
        users=users,
        active_users=users - disabled_users,
        disabled_users=disabled_users,
        total_credits=total_credits,
        flows=flows,
        assets=assets,
    )


@router.get("/billing-config", response_model=BillingConfigOut)
def get_admin_billing_config(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    config = get_billing_config(db)
    return BillingConfigOut(
        image_cost=config.image_cost,
        video_cost=config.video_cost,
        updated_at=config.updated_at,
    )


@router.put("/billing-config", response_model=BillingConfigOut)
def update_admin_billing_config(
    body: BillingConfigUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    config = get_billing_config(db)
    config.image_cost = body.image_cost
    config.video_cost = body.video_cost
    config.updated_by = admin.id
    db.commit()
    db.refresh(config)
    return BillingConfigOut(
        image_cost=config.image_cost,
        video_cost=config.video_cost,
        updated_at=config.updated_at,
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    q: str = "",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    query = db.query(User).order_by(User.created_at.desc())
    if q.strip():
        query = query.filter(User.email.ilike(f"%{q.strip()}%"))
    users = query.offset(offset).limit(limit).all()
    return [_user_out(db, user) for user in users]


@router.get("/users-page", response_model=AdminUserPageOut)
def list_users_page(
    q: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    query = db.query(User)
    if q.strip():
        query = query.filter(User.email.ilike(f"%{q.strip()}%"))
    total = query.count()
    total_pages = max(1, (total + page_size - 1) // page_size)
    current_page = min(page, total_pages)
    users = (
        query.order_by(User.created_at.desc())
        .offset((current_page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return AdminUserPageOut(
        items=[_user_out(db, user) for user in users],
        total=total,
        page=current_page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/users/{user_id}/flows", response_model=list[AdminFlowSummaryOut])
def list_user_flows(
    user_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    flows = (
        db.query(Flow)
        .filter(Flow.user_id == user.id)
        .order_by(Flow.updated_at.desc(), Flow.created_at.desc())
        .all()
    )
    return [
        AdminFlowSummaryOut(
            id=flow.id,
            name=flow.name,
            node_count=len(flow.nodes or []),
            edge_count=len(flow.edges or []),
            created_at=flow.created_at,
            updated_at=flow.updated_at,
        )
        for flow in flows
    ]


@router.get("/model-runs", response_model=list[AdminModelRunOut])
def list_model_runs(
    include_stale: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    runs: list[AdminModelRunOut] = []
    rows = db.query(Flow, User).join(User, Flow.user_id == User.id).all()
    now = datetime.now(timezone.utc)
    for flow, user in rows:
        runs.extend(_extract_model_runs(flow, user, now=now))
    if not include_stale:
        runs = [run for run in runs if not run.stale]
    return sorted(
        runs,
        key=lambda run: (
            run.stale,
            -(_aware_datetime(run.updated_at).timestamp() if run.updated_at else 0),
        ),
    )


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: str,
    body: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.role is not None:
        user.role = body.role

    if body.disabled is not None:
        if user.id == admin.id and body.disabled:
            raise HTTPException(status_code=400, detail="Cannot disable your own admin account")
        user.disabled_at = datetime.utcnow() if body.disabled else None

    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/users/{user_id}/credits", response_model=CreditAdjustResponse)
def adjust_credits(
    user_id: str,
    body: CreditAdjustRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    if body.amount == 0:
        raise HTTPException(status_code=400, detail="Amount cannot be zero")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    next_balance = user.credit_balance + body.amount
    if next_balance < 0:
        raise HTTPException(status_code=400, detail="Insufficient credits")

    user.credit_balance = next_balance
    transaction = CreditTransaction(
        id=str(uuid.uuid4()),
        user_id=user.id,
        admin_id=admin.id,
        amount=body.amount,
        balance_after=next_balance,
        transaction_type=body.transaction_type.strip() or "manual_adjustment",
        note=body.note.strip(),
    )
    db.add(transaction)
    db.commit()
    db.refresh(user)
    db.refresh(transaction)

    return CreditAdjustResponse(
        user=_user_out(db, user),
        transaction=_transaction_out(db, transaction),
    )


@router.get("/credit-transactions", response_model=list[CreditTransactionOut])
def list_credit_transactions(
    user_id: str = "",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    query = db.query(CreditTransaction).order_by(CreditTransaction.created_at.desc())
    if user_id:
        query = query.filter(CreditTransaction.user_id == user_id)
    transactions = query.offset(offset).limit(limit).all()
    return [_transaction_out(db, transaction) for transaction in transactions]
