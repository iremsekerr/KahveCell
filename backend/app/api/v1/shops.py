from math import atan2, cos, radians, sin, sqrt

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Product, Shop
from app.schemas.shops import ProductMenuItem, ShopDetail, ShopSummary

router = APIRouter(prefix="/shops", tags=["Dükkânlar"])
EARTH_RADIUS_KM = 6371.0088


def calculate_distance_km(
    latitude_a: float,
    longitude_a: float,
    latitude_b: float,
    longitude_b: float,
) -> float:
    latitude_delta = radians(latitude_b - latitude_a)
    longitude_delta = radians(longitude_b - longitude_a)
    haversine = (
        sin(latitude_delta / 2) ** 2
        + cos(radians(latitude_a))
        * cos(radians(latitude_b))
        * sin(longitude_delta / 2) ** 2
    )
    haversine = min(1.0, max(0.0, haversine))
    return 2 * EARTH_RADIUS_KM * atan2(
        sqrt(haversine), sqrt(1 - haversine)
    )


def get_menu(db: Session, shop_id: int) -> list[Product]:
    if db.get(Shop, shop_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dükkân bulunamadı.",
        )
    return list(
        db.scalars(
            select(Product)
            .where(Product.shop_id == shop_id, Product.is_available.is_(True))
            .order_by(Product.name)
        )
    )


@router.get("", response_model=list[ShopSummary])
def list_shops(
    q: str | None = Query(default=None, min_length=1, description="İsim veya adres"),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
) -> list[ShopSummary]:
    if (lat is None) != (lng is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Yakınlık araması için lat ve lng birlikte gönderilmelidir.",
        )
    if radius_km is not None and lat is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="radius_km kullanmak için lat ve lng de gönderilmelidir.",
        )

    shops = list(db.scalars(select(Shop).order_by(Shop.name)))
    if q is not None:
        search_term = q.strip().casefold()
        shops = [
            shop
            for shop in shops
            if search_term in shop.name.casefold()
            or search_term in shop.address.casefold()
        ]

    if lat is None or lng is None:
        return [ShopSummary.model_validate(shop) for shop in shops]

    nearby: list[tuple[Shop, float]] = [
        (
            shop,
            calculate_distance_km(lat, lng, shop.latitude, shop.longitude),
        )
        for shop in shops
    ]
    if radius_km is not None:
        nearby = [
            (shop, distance)
            for shop, distance in nearby
            if distance <= radius_km
        ]
    nearby.sort(key=lambda result: (result[1], result[0].name.casefold()))
    return [
        ShopSummary.model_validate(
            {**ShopSummary.model_validate(shop).model_dump(), "distance_km": round(distance, 2)}
        )
        for shop, distance in nearby
    ]


@router.get("/{shop_id}", response_model=ShopDetail)
def get_shop(
    shop_id: int,
    db: Session = Depends(get_db),
) -> ShopDetail:
    shop = db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dükkân bulunamadı.",
        )
    menu = get_menu(db, shop_id)
    return ShopDetail(
        **ShopSummary.model_validate(shop).model_dump(),
        menu=[ProductMenuItem.model_validate(product) for product in menu],
    )


@router.get("/{shop_id}/menu", response_model=list[ProductMenuItem])
def get_shop_menu(
    shop_id: int,
    db: Session = Depends(get_db),
) -> list[ProductMenuItem]:
    return [
        ProductMenuItem.model_validate(product)
        for product in get_menu(db, shop_id)
    ]
