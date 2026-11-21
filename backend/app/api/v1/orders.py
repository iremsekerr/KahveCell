import asyncio
import json
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.db.session import get_db
from app.models import (
    Order,
    OrderStatus,
    Product,
    Shop,
    Subscription,
    SubscriptionStatus,
    User,
    UserRole,
)
from app.schemas.orders import (
    OrderCreateRequest,
    OrderProgress,
    OrderResponse,
    OrderStatusRequest,
    OrderSummary,
    ShopOwnerOrderSummary,
    QRCodeDetails,
    QRCodePayload,
    QRVerificationResponse,
)
from app.services.order_qr import (
    _unsigned_payload,
    create_qr_image,
    create_qr_payload,
    verify_qr_signature,
)
from app.services.order_status_events import (
    OrderEventSubscription,
    order_status_events,
)

router = APIRouter(prefix="/orders", tags=["Siparişler"])

STATUS_MAP = {
    OrderStatus.PENDING: (OrderProgress.PENDING, "Beklemede"),
    OrderStatus.ACCEPTED: (OrderProgress.ACCEPTED, "Kabul Edildi"),
    OrderStatus.PREPARING: (OrderProgress.PREPARING, "Hazırlanıyor"),
    OrderStatus.READY: (OrderProgress.READY, "Hazır"),
    OrderStatus.COMPLETED: (OrderProgress.DELIVERED, "Teslim Edildi"),
    OrderStatus.CANCELLED: (OrderProgress.CANCELLED, "İptal Edildi"),
}
ALLOWED_SHOP_TRANSITIONS = {
    OrderStatus.PENDING: OrderStatus.ACCEPTED,
    OrderStatus.ACCEPTED: OrderStatus.PREPARING,
    OrderStatus.PREPARING: OrderStatus.READY,
}


def _order_summary(order: Order) -> OrderSummary:
    public_status, status_label = STATUS_MAP[order.status]
    return OrderSummary(
        id=order.id,
        order_id=UUID(order.qr_code),
        user_id=UUID(order.user.public_id),
        shop_id=UUID(order.shop.public_id),
        shop_name=order.shop.name,
        product_id=order.product_id,
        product_name=order.product.name,
        subscription_id=order.subscription_id,
        size=order.size,
        sugar_level=order.sugar_level,
        milk_preference=order.milk_preference,
        extra_shot=order.extra_shot,
        status=public_status,
        status_label=status_label,
        remaining_credits=(
            order.subscription.remaining_credits if order.subscription else None
        ),
        created_at=order.created_at,
    )


def _shop_owner_order_summary(order: Order) -> ShopOwnerOrderSummary:
    return ShopOwnerOrderSummary(
        **_order_summary(order).model_dump(),
        customer_name=f"{order.user.first_name} {order.user.last_name}".strip(),
        customer_phone=order.user.phone_number,
    )


def _order_response(order: Order) -> OrderResponse:
    summary = _order_summary(order)
    qr_payload = create_qr_payload(order, order.user, order.shop)
    return OrderResponse(
        **summary.model_dump(),
        qr_code=QRCodeDetails(
            payload=qr_payload,
            image_data_url=create_qr_image(qr_payload),
        ),
    )


def _status_event(order: Order) -> dict[str, int | str]:
    public_status, status_label = STATUS_MAP[order.status]
    return {
        "order_id": order.id,
        "status": public_status.value,
        "status_label": status_label,
    }


def _sse_message(event_name: str, data: dict[str, int | str]) -> str:
    return (
        f"event: {event_name}\n"
        f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    )


def _can_view_order(order: Order, user: User) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    if user.role == UserRole.SHOP_OWNER:
        return order.shop.owner_id == user.id
    return order.user_id == user.id


def _require_order_access(order: Order, user: User) -> None:
    if not _can_view_order(order, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu siparişi görüntüleme yetkiniz yok.",
        )


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    request: OrderCreateRequest,
    user: User = Depends(require_roles(UserRole.CUSTOMER)),
    db: Session = Depends(get_db),
) -> OrderResponse:
    shop = db.get(Shop, request.shop_id)
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dükkân bulunamadı.",
        )
    product = db.scalar(
        select(Product).where(
            Product.id == request.product_id,
            Product.shop_id == shop.id,
            Product.is_available.is_(True),
        )
    )
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu dükkânda sipariş edilebilir ürün bulunamadı.",
        )

    now = datetime.now(UTC)
    subscription = db.scalar(
        select(Subscription)
        .where(
            Subscription.user_id == user.id,
            Subscription.status == SubscriptionStatus.ACTIVE,
            or_(
                Subscription.expires_at.is_(None),
                Subscription.expires_at > now,
            ),
        )
        .order_by(Subscription.id.desc())
    )
    if subscription is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Aktif aboneliğiniz yok. Sipariş vermek için bir paket satın alın.",
        )
    if subscription.remaining_credits is not None and subscription.remaining_credits <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Kahve hakkınız bitmiş. Yeni dönem veya paket yükseltmesi gerekir.",
        )

    remaining_credits = case(
        (Subscription.remaining_credits.is_(None), None),
        else_=Subscription.remaining_credits - 1,
    )
    update_result = db.execute(
        update(Subscription)
        .where(
            Subscription.id == subscription.id,
            Subscription.status == SubscriptionStatus.ACTIVE,
            or_(
                Subscription.expires_at.is_(None),
                Subscription.expires_at > now,
            ),
            or_(
                Subscription.remaining_credits.is_(None),
                Subscription.remaining_credits > 0,
            ),
        )
        .values(
            remaining_credits=remaining_credits,
            credits_used=Subscription.credits_used + 1,
        )
        .execution_options(synchronize_session=False)
    )
    if update_result.rowcount != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Abonelik hakkınız kullanılamıyor. Lütfen yeniden deneyin.",
        )

    order = Order(
        user_id=user.id,
        shop_id=shop.id,
        product_id=product.id,
        subscription_id=subscription.id,
        size=request.size.value,
        sugar_level=request.sugar_level,
        milk_preference=(
            request.milk_preference.value if request.milk_preference else None
        ),
        extra_shot=request.extra_shot,
        status=OrderStatus.PENDING,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    db.refresh(subscription)
    return _order_response(order)


@router.get("/history", response_model=list[OrderSummary])
def order_history(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OrderSummary]:
    query = select(Order).order_by(Order.created_at.desc())
    if user.role == UserRole.CUSTOMER:
        query = query.where(Order.user_id == user.id)
    elif user.role == UserRole.SHOP_OWNER:
        query = query.join(Shop).where(Shop.owner_id == user.id)

    orders = db.scalars(query).unique()
    return [_order_summary(order) for order in orders]


@router.get("/{order_id}/events")
async def order_status_stream(
    order_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    subscription: OrderEventSubscription = order_status_events.subscribe(order_id)
    authorized = False
    try:
        order = db.get(Order, order_id)
        if order is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sipariş bulunamadı.",
            )
        _require_order_access(order, user)
        initial_status = _status_event(order)
        authorized = True
    finally:
        db.close()
        if not authorized:
            order_status_events.unsubscribe(subscription)

    async def stream_events():
        try:
            yield _sse_message("snapshot", initial_status)
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(
                        subscription.queue.get(),
                        timeout=15,
                    )
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                else:
                    yield _sse_message("status", event)
        finally:
            order_status_events.unsubscribe(subscription)

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/verify-qr", response_model=QRVerificationResponse)
def verify_order_qr(
    payload: QRCodePayload,
    user: User = Depends(require_roles(UserRole.SHOP_OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> QRVerificationResponse:
    if not verify_qr_signature(payload):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR imzası geçersiz; kod doğrulanamadı.",
        )

    order = db.scalar(select(Order).where(Order.qr_code == str(payload.order_id)))
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="QR koduna ait sipariş bulunamadı.",
        )
    if _unsigned_payload(order, order.user, order.shop) != {
        "order_id": str(payload.order_id),
        "user_id": str(payload.user_id),
        "shop_id": str(payload.shop_id),
        "created_at": payload.created_at,
    }:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="QR içeriği sipariş kaydıyla eşleşmiyor.",
        )
    if user.role == UserRole.SHOP_OWNER and order.shop.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu dükkânın siparişlerini teslim etme yetkiniz yok.",
        )
    if order.status != OrderStatus.READY:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sipariş teslim için hazır değil veya daha önce teslim edilmiş.",
        )

    order.status = OrderStatus.COMPLETED
    db.commit()
    db.refresh(order)
    order_status_events.publish(order.id, _status_event(order))
    return QRVerificationResponse(
        valid=True,
        message="QR imzası doğrulandı; sipariş teslim edildi.",
        order_id=UUID(order.qr_code),
        status=OrderProgress.DELIVERED,
        status_label="Teslim Edildi",
    )


@router.get(
    "/shop-owner",
    response_model=list[ShopOwnerOrderSummary],
)
def list_shop_owner_orders(
    user: User = Depends(require_roles(UserRole.SHOP_OWNER)),
    db: Session = Depends(get_db),
) -> list[ShopOwnerOrderSummary]:
    orders = db.scalars(
        select(Order)
        .join(Shop)
        .where(
            Shop.owner_id == user.id,
            Order.status.in_(
                [
                    OrderStatus.PENDING,
                    OrderStatus.ACCEPTED,
                    OrderStatus.PREPARING,
                    OrderStatus.READY,
                ]
            ),
        )
        .options(
            selectinload(Order.user),
            selectinload(Order.shop),
            selectinload(Order.product),
            selectinload(Order.subscription),
        )
        .order_by(Order.created_at.desc())
    ).unique()
    return [_shop_owner_order_summary(order) for order in orders]


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrderResponse:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sipariş bulunamadı.",
        )
    _require_order_access(order, user)
    return _order_response(order)


@router.patch("/{order_id}/status", response_model=OrderSummary)
def update_order_status(
    order_id: int,
    request: OrderStatusRequest,
    user: User = Depends(require_roles(UserRole.SHOP_OWNER, UserRole.ADMIN)),
    db: Session = Depends(get_db),
) -> OrderSummary:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sipariş bulunamadı.",
        )
    if user.role == UserRole.SHOP_OWNER and order.shop.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu dükkânın siparişlerini güncelleme yetkiniz yok.",
        )

    next_status = OrderStatus(request.status.value)
    if ALLOWED_SHOP_TRANSITIONS.get(order.status) != next_status:
        expected = ALLOWED_SHOP_TRANSITIONS.get(order.status)
        expected_label = STATUS_MAP[expected][1] if expected else "QR ile teslim"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Geçersiz durum geçişi. Beklenen sonraki durum: {expected_label}.",
        )

    order.status = next_status
    db.commit()
    db.refresh(order)
    order_status_events.publish(order.id, _status_event(order))
    return _order_summary(order)
