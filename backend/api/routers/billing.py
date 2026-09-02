from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from billing import get_billing_config
from database import get_db
from models import User


router = APIRouter(prefix="/billing", tags=["billing"])


class BillingStatusOut(BaseModel):
    credit_balance: int
    image_cost: int
    video_cost: int
    updated_at: Optional[datetime] = None


@router.get("/status", response_model=BillingStatusOut)
def billing_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    config = get_billing_config(db)
    return BillingStatusOut(
        credit_balance=user.credit_balance,
        image_cost=config.image_cost,
        video_cost=config.video_cost,
        updated_at=config.updated_at,
    )
