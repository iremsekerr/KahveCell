from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Subscription, User
from app.schemas.subscriptions import (
    CancelSubscriptionResponse,
    PlanResponse,
    SubscriptionChangeRequest,
    SubscriptionOperationResponse,
    SubscriptionPurchaseRequest,
    SubscriptionResponse,
)
from app.services.subscription_service import (
    PLANS,
    cancel_subscription,
    change_subscription,
    find_active_subscription,
    purchase_subscription,
)

router = APIRouter(prefix="/subscriptions", tags=["Abonelikler"])


def _purchase(
    request: SubscriptionPurchaseRequest,
    user: User,
    db: Session,
) -> SubscriptionOperationResponse:
    result = purchase_subscription(db, user, request.plan_type, request.card_number)
    return SubscriptionOperationResponse(
        success=result.success,
        message=result.message,
        amount=result.amount,
        transaction_id=result.transaction.transaction_id if result.transaction else None,
        payment_status=result.transaction.status if result.transaction else None,
        timestamp=result.timestamp,
        subscription=result.subscription,
    )


@router.get("/plans", response_model=list[PlanResponse])
def list_plans() -> list[PlanResponse]:
    return [
        PlanResponse(
            plan_type=plan_type,
            name=plan.name,
            monthly_price=plan.monthly_price,
            monthly_coffee_limit=plan.monthly_coffee_limit,
            guest_credits=plan.guest_credits,
            priority_access=plan.priority_access,
        )
        for plan_type, plan in PLANS.items()
    ]


@router.post("", response_model=SubscriptionOperationResponse)
def subscribe(
    request: SubscriptionPurchaseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubscriptionOperationResponse:
    return _purchase(request, user, db)


@router.get("/me", response_model=SubscriptionResponse)
def get_my_subscription(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Subscription:
    subscription = find_active_subscription(db, user.id)
    if subscription is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aktif aboneliğiniz bulunmuyor.",
        )
    return subscription


@router.patch("/me", response_model=SubscriptionOperationResponse)
def change_my_subscription(
    request: SubscriptionChangeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubscriptionOperationResponse:
    subscription = find_active_subscription(db, user.id)
    if subscription is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Değiştirilecek aktif aboneliğiniz bulunmuyor.",
        )
    current_plan = PLANS[subscription.plan_type]
    target_plan = PLANS[request.plan_type]
    if request.plan_type == subscription.plan_type:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Zaten bu pakete sahipsiniz.",
        )
    if target_plan.monthly_price > current_plan.monthly_price and not request.card_number:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Yükseltme için kart numarası gereklidir.",
        )

    result = change_subscription(
        db, user, subscription, request.plan_type, request.card_number
    )
    return SubscriptionOperationResponse(
        success=result.success,
        message=result.message,
        amount=result.amount,
        transaction_id=result.transaction.transaction_id if result.transaction else None,
        payment_status=result.transaction.status if result.transaction else None,
        timestamp=result.timestamp,
        subscription=result.subscription,
    )


@router.delete("/me", response_model=CancelSubscriptionResponse)
def cancel_my_subscription(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CancelSubscriptionResponse:
    subscription = find_active_subscription(db, user.id)
    if subscription is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="İptal edilecek aktif aboneliğiniz bulunmuyor.",
        )
    cancel_subscription(db, subscription)
    return CancelSubscriptionResponse(
        message="Abonelik hemen iptal edildi. Ödeme iadesi yapılmadı.",
        subscription=subscription,
        refund_amount=Decimal("0.00"),
    )
