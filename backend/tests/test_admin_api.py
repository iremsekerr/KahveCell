from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_token
from app.db.session import get_db
from app.main import app
from app.models import (
    Base,
    Order,
    OrderStatus,
    PaymentStatus,
    PaymentTransaction,
    PlanType,
    Product,
    Shop,
    Subscription,
    SubscriptionStatus,
    User,
    UserRole,
)


@pytest.fixture
def admin_api() -> Iterator[dict[str, object]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db():
        with test_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with test_session.begin() as session:
        admin = User(
            phone_number="+905550002001",
            first_name="Admin",
            last_name="Test",
            role=UserRole.ADMIN,
        )
        owner = User(
            phone_number="+905550002002",
            first_name="Shop",
            last_name="Owner",
            role=UserRole.SHOP_OWNER,
        )
        customer = User(
            phone_number="+905550002003",
            first_name="Coffee",
            last_name="Customer",
            role=UserRole.CUSTOMER,
        )
        session.add_all([admin, owner, customer])
        session.flush()

        shop = Shop(
            owner_id=owner.id,
            name="Admin Test Cafe",
            address="Kızılay, Ankara",
            latitude=39.9208,
            longitude=32.8541,
        )
        session.add(shop)
        session.flush()
        product = Product(
            shop_id=shop.id,
            name="Cappuccino",
            category="Espresso",
            price=Decimal("120.00"),
            is_available=True,
        )
        subscription = Subscription(
            user_id=customer.id,
            plan_type=PlanType.STARTER,
            monthly_price=Decimal("89.99"),
            monthly_coffee_limit=10,
            remaining_credits=8,
            credits_used=2,
            guest_credits=0,
            status=SubscriptionStatus.ACTIVE,
            started_at=datetime.now(UTC),
            expires_at=datetime.now(UTC) + timedelta(days=30),
        )
        session.add_all([product, subscription])
        session.flush()
        order = Order(
            user_id=customer.id,
            shop_id=shop.id,
            product_id=product.id,
            subscription_id=subscription.id,
            size="M",
            sugar_level=1,
            milk_preference="OAT",
            extra_shot=False,
            status=OrderStatus.PENDING,
        )
        payment = PaymentTransaction(
            user_id=customer.id,
            subscription_id=subscription.id,
            plan_type=PlanType.STARTER,
            amount=Decimal("89.99"),
            status=PaymentStatus.SUCCEEDED,
            card_last_four="4242",
        )
        session.add_all([order, payment])
        session.flush()

        tokens = {
            "admin": create_token(
                str(admin.id),
                "access",
                datetime.now(UTC) + timedelta(minutes=10),
            )[0],
            "owner": create_token(
                str(owner.id),
                "access",
                datetime.now(UTC) + timedelta(minutes=10),
            )[0],
            "customer": create_token(
                str(customer.id),
                "access",
                datetime.now(UTC) + timedelta(minutes=10),
            )[0],
        }
        values = {
            "shop_id": shop.id,
            "owner_id": owner.id,
            "customer_id": customer.id,
            "tokens": tokens,
        }

    try:
        with TestClient(app) as client:
            yield {"client": client, **values}
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_console_lists_and_assigns_shop_owners(
    admin_api: dict[str, object],
) -> None:
    client = admin_api["client"]
    tokens = admin_api["tokens"]
    admin_headers = _auth(tokens["admin"])
    customer_headers = _auth(tokens["customer"])

    assert client.get("/api/v1/admin/shops", headers=customer_headers).status_code == 403
    assert client.get("/api/v1/admin/orders", headers=customer_headers).status_code == 403

    shops = client.get("/api/v1/admin/shops", headers=admin_headers)
    assert shops.status_code == 200
    assert shops.json()[0]["owner_name"] == "Shop Owner"

    owners = client.get("/api/v1/admin/shop-owners", headers=admin_headers)
    assert owners.status_code == 200
    assert [owner["id"] for owner in owners.json()] == [admin_api["owner_id"]]

    invalid_owner = client.patch(
        f"/api/v1/admin/shops/{admin_api['shop_id']}/owner",
        headers=admin_headers,
        json={"owner_id": admin_api["customer_id"]},
    )
    assert invalid_owner.status_code == 422

    unassign = client.patch(
        f"/api/v1/admin/shops/{admin_api['shop_id']}/owner",
        headers=admin_headers,
        json={"owner_id": None},
    )
    assert unassign.status_code == 200
    assert unassign.json()["owner_id"] is None


def test_admin_console_lists_orders_subscriptions_and_payments(
    admin_api: dict[str, object],
) -> None:
    client = admin_api["client"]
    headers = _auth(admin_api["tokens"]["admin"])

    orders = client.get("/api/v1/admin/orders", headers=headers)
    assert orders.status_code == 200
    assert orders.json()[0]["customer_name"] == "Coffee Customer"
    assert orders.json()[0]["status"] == "PENDING"

    subscriptions = client.get("/api/v1/admin/subscriptions", headers=headers)
    assert subscriptions.status_code == 200
    assert subscriptions.json()[0]["plan_type"] == "STARTER"
    assert subscriptions.json()[0]["customer_phone"] == "+905550002003"

    payments = client.get("/api/v1/admin/payments", headers=headers)
    assert payments.status_code == 200
    assert payments.json()[0]["card_last_four"] == "4242"
    assert payments.json()[0]["customer_name"] == "Coffee Customer"
