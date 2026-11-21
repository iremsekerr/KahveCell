from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload, selectinload

from app.core.security import require_roles
from app.db.session import get_db
from app.models import (
    Order,
    OrderStatus,
    PaymentTransaction,
    Shop,
    Subscription,
    User,
    UserRole,
)
from app.schemas.admin import (
    AdminOrderSummary,
    AdminPaymentSummary,
    AdminShopSummary,
    AdminSubscriptionSummary,
    ShopOwnerAssignmentRequest,
)
from app.schemas.auth import RoleUpdateRequest, UserResponse
from app.schemas.orders import OrderProgress
from app.schemas.shops import ShopSummary
from app.schemas.subscriptions import SubscriptionResponse

router = APIRouter(prefix="/admin", tags=["Yönetim"])


def _shop_summary(shop: Shop) -> AdminShopSummary:
    owner = shop.owner
    return AdminShopSummary(
        **ShopSummary.model_validate(shop).model_dump(),
        owner_id=shop.owner_id,
        owner_name=(
            f"{owner.first_name} {owner.last_name}".strip() if owner else None
        ),
        owner_phone_number=owner.phone_number if owner else None,
    )


def _order_summary(order: Order) -> AdminOrderSummary:
    return AdminOrderSummary(
        id=order.id,
        order_id=UUID(order.qr_code),
        shop_name=order.shop.name,
        product_name=order.product.name,
        status=(
            OrderProgress.DELIVERED
            if order.status == OrderStatus.COMPLETED
            else OrderProgress(order.status.value)
        ),
        size=order.size,
        sugar_level=order.sugar_level,
        milk_preference=order.milk_preference,
        extra_shot=order.extra_shot,
        created_at=order.created_at,
        customer_name=f"{order.user.first_name} {order.user.last_name}".strip(),
        customer_phone=order.user.phone_number,
    )


def _user_name(user: User) -> str:
    return f"{user.first_name} {user.last_name}".strip()


@router.get("/shop-owners", response_model=list[UserResponse])
def list_shop_owners(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(User.role == UserRole.SHOP_OWNER)
            .order_by(User.first_name, User.last_name)
        )
    )


@router.get("/shops", response_model=list[AdminShopSummary])
def list_admin_shops(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> list[AdminShopSummary]:
    shops = db.scalars(
        select(Shop)
        .options(joinedload(Shop.owner))
        .order_by(Shop.name)
    ).unique()
    return [_shop_summary(shop) for shop in shops]


@router.patch("/shops/{shop_id}/owner", response_model=AdminShopSummary)
def assign_shop_owner(
    shop_id: int,
    request: ShopOwnerAssignmentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> AdminShopSummary:
    shop = db.scalar(
        select(Shop).options(joinedload(Shop.owner)).where(Shop.id == shop_id)
    )
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dükkân bulunamadı.",
        )

    owner = None
    if request.owner_id is not None:
        owner = db.get(User, request.owner_id)
        if owner is None or owner.role != UserRole.SHOP_OWNER:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Seçilen kullanıcı dükkân sahibi rolünde değil.",
            )

    shop.owner = owner
    db.commit()
    db.refresh(shop)
    return _shop_summary(shop)


@router.get("/orders", response_model=list[AdminOrderSummary])
def list_admin_orders(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> list[AdminOrderSummary]:
    orders = db.scalars(
        select(Order)
        .options(
            selectinload(Order.user),
            selectinload(Order.shop),
            selectinload(Order.product),
        )
        .order_by(Order.created_at.desc())
    ).unique()
    return [_order_summary(order) for order in orders]


@router.get("/subscriptions", response_model=list[AdminSubscriptionSummary])
def list_admin_subscriptions(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> list[AdminSubscriptionSummary]:
    subscriptions = db.scalars(
        select(Subscription)
        .options(joinedload(Subscription.user))
        .order_by(Subscription.started_at.desc())
    ).unique()
    return [
        AdminSubscriptionSummary(
            **SubscriptionResponse.model_validate(subscription).model_dump(),
            user_id=subscription.user_id,
            customer_name=_user_name(subscription.user),
            customer_phone=subscription.user.phone_number,
        )
        for subscription in subscriptions
    ]


@router.get("/payments", response_model=list[AdminPaymentSummary])
def list_admin_payments(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> list[AdminPaymentSummary]:
    payments = db.execute(
        select(PaymentTransaction, User)
        .join(User, PaymentTransaction.user_id == User.id)
        .order_by(PaymentTransaction.created_at.desc())
    ).all()
    return [
        AdminPaymentSummary(
            transaction_id=payment.transaction_id,
            plan_type=payment.plan_type,
            amount=payment.amount,
            status=payment.status,
            card_last_four=payment.card_last_four,
            created_at=payment.created_at,
            user_id=payment.user_id,
            customer_name=_user_name(user),
            customer_phone=user.phone_number,
        )
        for payment, user in payments
    ]


@router.patch("/users/{user_id}/role", response_model=UserResponse)
def update_user_role(
    user_id: int,
    request: RoleUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kullanıcı bulunamadı.",
        )
    user.role = request.role
    db.commit()
    db.refresh(user)
    return user
