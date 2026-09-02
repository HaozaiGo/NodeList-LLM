import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import BillingConfig, CreditTransaction, User


BILLING_CONFIG_ID = "default"
GENERATION_LABELS = {"image": "图片", "video": "视频"}


@dataclass(frozen=True)
class GenerationCharge:
    transaction_id: str
    amount: int
    kind: str
    units: int


def get_billing_config(db: Session) -> BillingConfig:
    config = db.get(BillingConfig, BILLING_CONFIG_ID)
    if config:
        return config
    config = BillingConfig(id=BILLING_CONFIG_ID, image_cost=0, video_cost=0)
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def reserve_generation_credits(
    db: Session,
    user: User,
    *,
    kind: str,
    units: int = 1,
    note: str = "",
) -> Optional[GenerationCharge]:
    if kind not in GENERATION_LABELS:
        raise ValueError(f"Unsupported generation billing kind: {kind}")
    normalized_units = max(1, int(units))
    config = get_billing_config(db)
    unit_cost = config.image_cost if kind == "image" else config.video_cost
    amount = max(0, int(unit_cost or 0)) * normalized_units
    if amount == 0:
        return None

    locked_user = db.query(User).filter(User.id == user.id).with_for_update().one_or_none()
    if not locked_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if locked_user.credit_balance < amount:
        label = GENERATION_LABELS[kind]
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"积分不足：本次{label}生成需要 {amount} 积分，当前余额 {locked_user.credit_balance}",
        )

    locked_user.credit_balance -= amount
    transaction = CreditTransaction(
        id=str(uuid.uuid4()),
        user_id=locked_user.id,
        amount=-amount,
        balance_after=locked_user.credit_balance,
        transaction_type=f"generation_{kind}",
        note=note.strip() or f"{GENERATION_LABELS[kind]}生成 {normalized_units} 个",
    )
    db.add(transaction)
    db.commit()
    return GenerationCharge(
        transaction_id=transaction.id,
        amount=amount,
        kind=kind,
        units=normalized_units,
    )


def finalize_generation_charge(db: Session, charge: Optional[GenerationCharge], task_id: str) -> None:
    if not charge or not task_id:
        return
    transaction = db.get(CreditTransaction, charge.transaction_id)
    if not transaction:
        return
    transaction.note = f"{transaction.note} · 任务 {task_id}"
    db.commit()


def refund_generation_credits(
    db: Session,
    user: User,
    charge: Optional[GenerationCharge],
    *,
    reason: str,
) -> None:
    if not charge:
        return
    locked_user = db.query(User).filter(User.id == user.id).with_for_update().one_or_none()
    if not locked_user:
        return
    locked_user.credit_balance += charge.amount
    db.add(
        CreditTransaction(
            id=str(uuid.uuid4()),
            user_id=locked_user.id,
            amount=charge.amount,
            balance_after=locked_user.credit_balance,
            transaction_type="generation_refund",
            note=f"{GENERATION_LABELS[charge.kind]}任务创建失败退款 · {reason[:160]}",
        )
    )
    db.commit()
