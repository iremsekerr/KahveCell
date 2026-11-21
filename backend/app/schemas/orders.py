from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CupSize(str, Enum):
    S = "S"
    M = "M"
    L = "L"


class MilkPreference(str, Enum):
    WHOLE = "WHOLE"
    OAT = "OAT"
    ALMOND = "ALMOND"
    SOY = "SOY"
    LACTOSE_FREE = "LACTOSE_FREE"


class OrderProgress(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class ShopOrderProgress(str, Enum):
    ACCEPTED = "ACCEPTED"
    PREPARING = "PREPARING"
    READY = "READY"


class OrderCreateRequest(BaseModel):
    shop_id: int = Field(gt=0)
    product_id: int = Field(gt=0)
    size: CupSize = CupSize.M
    sugar_level: int = Field(default=0, ge=0, le=5)
    milk_preference: MilkPreference | None = None
    extra_shot: bool = False


class QRCodePayload(BaseModel):
    order_id: UUID
    user_id: UUID
    shop_id: UUID
    created_at: str
    signature: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("created_at")
    @classmethod
    def validate_timestamp(cls, value: str) -> str:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("created_at geçerli bir ISO8601 tarihi olmalıdır.") from exc
        if parsed.tzinfo is None:
            raise ValueError("created_at saat dilimi içermelidir.")
        return value


class QRCodeDetails(BaseModel):
    payload: QRCodePayload
    image_data_url: str


class OrderSummary(BaseModel):
    id: int
    order_id: UUID
    user_id: UUID
    shop_id: UUID
    shop_name: str
    product_id: int
    product_name: str
    subscription_id: int
    size: CupSize
    sugar_level: int
    milk_preference: MilkPreference | None
    extra_shot: bool
    status: OrderProgress
    status_label: str
    remaining_credits: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShopOwnerOrderSummary(OrderSummary):
    customer_name: str
    customer_phone: str


class OrderResponse(OrderSummary):
    qr_code: QRCodeDetails


class OrderStatusRequest(BaseModel):
    status: ShopOrderProgress


class QRVerificationResponse(BaseModel):
    valid: bool
    message: str
    order_id: UUID
    status: OrderProgress
    status_label: str

