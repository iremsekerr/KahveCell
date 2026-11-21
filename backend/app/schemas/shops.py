from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ProductMenuItem(BaseModel):
    id: int
    name: str
    category: str
    description: str | None
    price: Decimal
    is_available: bool

    model_config = ConfigDict(from_attributes=True)


class ShopSummary(BaseModel):
    id: int
    name: str
    address: str
    latitude: float
    longitude: float
    working_hours: dict[str, str] | None
    rating: float | None
    distance_km: float | None = None

    model_config = ConfigDict(from_attributes=True)


class ShopDetail(ShopSummary):
    menu: list[ProductMenuItem]
