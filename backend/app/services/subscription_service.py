from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    PaymentStatus,
    PaymentTransaction,
    PlanType,
    Subscription,
    SubscriptionStatus,
    User,
)


@dataclass(frozen=True)
class Plan:
    name: str
    monthly_price: Decimal
    monthly_coffee_limit: int | None
    guest_credits: int
    priority_access: bool


PLANS = {
    PlanType.STARTER: Plan("Starter", Decimal("89.99"), 10, 0, False),
    PlanType.PREMIUM: Plan("Premium", Decimal("149.99"), 20, 2, False),
    PlanType.UNLIMITED: Plan("Unlimited", Decimal("249.99"), None, 5, True),
}

SUCCESS_CARD = "4242424242424242"
DECLINED_CARD = "4000000000000002"


@dataclass
class OperationResult:
    success: bool
    message: str
    amount: Decimal
    timestamp: datetime
    transaction: PaymentTransaction | None
    subscription: Subscription | None


def find_active_subscription(db: Session, user_id: int) -> Subscription | None:
    return db.scalar(
        select(Subscription)
        .where(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.ACTIVE,
        )
        .order_by(Subscription.id.desc())
    )


def _create_payment(
    db: Session,
    user: User,
    plan_type: PlanType,
    amount: Decimal,
    card_number: str,
    subscription: Subscription | None,
) -> tuple[PaymentTransaction, bool, str]:
    succeeded = card_number == SUCCESS_CARD
    if card_number == SUCCESS_CARD:
        message = "Simülasyon ödemesi başarılı."
    elif card_number == DECLINED_CARD:
        message = "Test kartı ile ödeme reddedildi."
    else:
        message = "Simülasyonda bu kart numarası desteklenmiyor."

    transaction = PaymentTransaction(
        transaction_id=str(uuid4()),
        user_id=user.id,
        subscription_id=subscription.id if subscription else None,
        plan_type=plan_type,
        amount=amount,
        status=PaymentStatus.SUCCEEDED if succeeded else PaymentStatus.FAILED,
        card_last_four=card_number[-4:],
    )
    db.add(transaction)
    return transaction, succeeded, message


def _set_plan_entitlements(subscription: Subscription, plan_type: PlanType) -> None:
    plan = PLANS[plan_type]
    subscription.plan_type = plan_type
    subscription.monthly_price = plan.monthly_price
    subscription.monthly_coffee_limit = plan.monthly_coffee_limit
    subscription.guest_credits = plan.guest_credits
    subscription.remaining_credits = (
        None
        if plan.monthly_coffee_limit is None
        else max(0, plan.monthly_coffee_limit - subscription.credits_used)
    )


def purchase_subscription(
    db: Session,
    user: User,
    plan_type: PlanType,
    card_number: str,
) -> OperationResult:
    now = datetime.now(UTC)
    previous_subscription = find_active_subscription(db, user.id)
    plan = PLANS[plan_type]
    transaction, succeeded, message = _create_payment(
        db, user, plan_type, plan.monthly_price, card_number, previous_subscription
    )
    if not succeeded:
        db.commit()
        return OperationResult(
            False, message, transaction.amount, now, transaction, previous_subscription
        )

    if previous_subscription is not None:
        previous_subscription.status = SubscriptionStatus.CANCELLED
        previous_subscription.remaining_credits = 0

    subscription = Subscription(
        user_id=user.id,
        plan_type=plan_type,
        monthly_price=plan.monthly_price,
        monthly_coffee_limit=plan.monthly_coffee_limit,
        remaining_credits=plan.monthly_coffee_limit,
        credits_used=0,
        guest_credits=plan.guest_credits,
        status=SubscriptionStatus.ACTIVE,
        started_at=now,
        expires_at=now + timedelta(days=30),
    )
    db.add(subscription)
    db.flush()
    transaction.subscription_id = subscription.id
    db.commit()
    db.refresh(subscription)
    db.refresh(transaction)
    return OperationResult(True, message, transaction.amount, now, transaction, subscription)


def change_subscription(
    db: Session,
    user: User,
    subscription: Subscription,
    new_plan_type: PlanType,
    card_number: str | None,
) -> OperationResult:
    now = datetime.now(UTC)
    old_plan = PLANS[subscription.plan_type]
    new_plan = PLANS[new_plan_type]
    if new_plan_type == subscription.plan_type:
        raise ValueError("Kullanıcı zaten bu pakette.")

    if new_plan.monthly_price > old_plan.monthly_price:
        if card_number is None:
            raise ValueError("Yükseltme için kart numarası gereklidir.")
        amount = new_plan.monthly_price - old_plan.monthly_price
        transaction, succeeded, message = _create_payment(
            db, user, new_plan_type, amount, card_number, subscription
        )
        if not succeeded:
            db.commit()
            return OperationResult(
                False, message, amount, now, transaction, subscription
            )
    else:
        amount = Decimal("0.00")
        transaction = None
        message = "Paket düşürme hemen uygulandı; iade yapılmadı."

    _set_plan_entitlements(subscription, new_plan_type)
    if transaction is not None:
        db.flush()
    db.commit()
    db.refresh(subscription)
    if transaction is not None:
        db.refresh(transaction)
    return OperationResult(True, message, amount, now, transaction, subscription)


def cancel_subscription(db: Session, subscription: Subscription) -> None:
    subscription.status = SubscriptionStatus.CANCELLED
    subscription.remaining_credits = 0
    db.commit()
    db.refresh(subscription)
