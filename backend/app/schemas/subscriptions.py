import re
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import PaymentStatus, PlanType, SubscriptionStatus


def normalize_card_number(value: str) -> str:
    card_number = re.sub(r"[\s-]", "", value)
    if not re.fullmatch(r"\d{16}", card_number):
        raise ValueError("Kart numarası 16 rakam olmalıdır.")
    return card_number


class PlanResponse(BaseModel):
    plan_type: PlanType
    name: str
    monthly_price: Decimal
    monthly_coffee_limit: int | None
    guest_credits: int
    priority_access: bool


class SubscriptionResponse(BaseModel):
    id: int
    plan_type: PlanType
    monthly_price: Decimal
    monthly_coffee_limit: int | None
    remaining_credits: int | None
    credits_used: int
    guest_credits: int
    status: SubscriptionStatus
    started_at: datetime
    expires_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class SubscriptionPurchaseRequest(BaseModel):
    plan_type: PlanType
    card_number: str = Field(
        description="Simülasyon kartı: 4242... başarılı, 4000... başarısız.",
        examples=["4242424242424242"],
    )

    @field_validator("card_number")
    @classmethod
    def validate_card_number(cls, value: str) -> str:
        return normalize_card_number(value)


class SubscriptionChangeRequest(BaseModel):
    plan_type: PlanType
    card_number: str | None = Field(
        default=None,
        description="Yalnızca yükseltme farkı alınırken gereklidir.",
        examples=["4242424242424242"],
    )

    @field_validator("card_number")
    @classmethod
    def validate_card_number(cls, value: str | None) -> str | None:
        return normalize_card_number(value) if value is not None else None


class SubscriptionOperationResponse(BaseModel):
    success: bool
    message: str
    amount: Decimal
    transaction_id: str | None = None
    payment_status: PaymentStatus | None = None
    timestamp: datetime
    subscription: SubscriptionResponse | None


class PaymentHistoryItem(BaseModel):
    transaction_id: str
    plan_type: PlanType
    amount: Decimal
    status: PaymentStatus
    card_last_four: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CancelSubscriptionResponse(BaseModel):
    message: str
    subscription: SubscriptionResponse
    refund_amount: Decimal = Decimal("0.00")


