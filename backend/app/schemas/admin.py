from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.orders import OrderProgress
from app.schemas.shops import ShopSummary
from app.schemas.subscriptions import PaymentHistoryItem, SubscriptionResponse


class AdminShopSummary(ShopSummary):
    owner_id: int | None
    owner_name: str | None
    owner_phone_number: str | None


class ShopOwnerAssignmentRequest(BaseModel):
    owner_id: int | None


class AdminOrderSummary(BaseModel):
    id: int
    order_id: UUID
    shop_name: str
    product_name: str
    status: OrderProgress
    size: str
    sugar_level: int
    milk_preference: str | None
    extra_shot: bool
    created_at: datetime
    customer_name: str
    customer_phone: str


class AdminSubscriptionSummary(SubscriptionResponse):
    user_id: int
    customer_name: str
    customer_phone: str


class AdminPaymentSummary(PaymentHistoryItem):
    user_id: int
    customer_name: str
    customer_phone: str
