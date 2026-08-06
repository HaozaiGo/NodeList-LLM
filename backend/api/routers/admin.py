import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_admin
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
