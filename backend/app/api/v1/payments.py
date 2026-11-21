from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.subscriptions import _purchase
from app.core.security import get_current_user
from app.db.session import get_db
from app.models import PaymentTransaction, User
from app.schemas.subscriptions import (
    PaymentHistoryItem,
    SubscriptionOperationResponse,
    SubscriptionPurchaseRequest,
)

router = APIRouter(prefix="/payments", tags=["Paycell simülasyonu"])


@router.post("/process", response_model=SubscriptionOperationResponse)
def process_payment(
    request: SubscriptionPurchaseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubscriptionOperationResponse:
    return _purchase(request, user, db)


@router.get("/history", response_model=list[PaymentHistoryItem])
def payment_history(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PaymentTransaction]:
    return list(
        db.scalars(
            select(PaymentTransaction)
            .where(PaymentTransaction.user_id == user.id)
            .order_by(PaymentTransaction.created_at.desc())
        )
    )
