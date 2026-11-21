import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_token
from app.db.session import get_db
from app.main import app
from app.models import (
    Base,
    Product,
    Shop,
    Subscription,
    SubscriptionStatus,
    User,
    UserRole,
)
from app.services.order_status_events import order_status_events


@pytest.fixture
def order_api() -> Iterator[dict[str, object]]:
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(test_engine)
    test_session = sessionmaker(bind=test_engine, expire_on_commit=False)

    def override_get_db():
        with test_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with test_session.begin() as session:
        owner = User(
            phone_number="+905550001001",
            first_name="Shop",
            last_name="Owner",
            role=UserRole.SHOP_OWNER,
        )
        customer = User(
            phone_number="+905550001002",
            first_name="Coffee",
            last_name="Customer",
            role=UserRole.CUSTOMER,
        )
        unlimited_customer = User(
            phone_number="+905550001003",
            first_name="Unlimited",
            last_name="Customer",
            role=UserRole.CUSTOMER,
        )
        no_subscription_customer = User(
            phone_number="+905550001004",
            first_name="No",
            last_name="Subscription",
            role=UserRole.CUSTOMER,
        )
        session.add_all(
            [owner, customer, unlimited_customer, no_subscription_customer]
        )
        session.flush()

        shop = Shop(
            owner_id=owner.id,
            name="Test Kızılay Cafe",
            address="Kızılay, Ankara",
            latitude=39.9208,
            longitude=32.8541,
        )
        session.add(shop)
        session.flush()
        product = Product(
            shop_id=shop.id,
            name="Espresso",
            category="Coffee",
            price=100,
            is_available=True,
        )
        session.add(product)

        now = datetime.now(UTC)
        session.add_all(
            [
                Subscription(
                    user_id=customer.id,
                    plan_type="STARTER",
                    monthly_price=89.99,
                    monthly_coffee_limit=10,
                    remaining_credits=1,
                    credits_used=9,
                    guest_credits=0,
                    status=SubscriptionStatus.ACTIVE,
                    started_at=now,
                    expires_at=now + timedelta(days=30),
                ),
                Subscription(
                    user_id=unlimited_customer.id,
                    plan_type="UNLIMITED",
                    monthly_price=249.99,
                    monthly_coffee_limit=None,
                    remaining_credits=None,
                    credits_used=0,
                    guest_credits=5,
                    status=SubscriptionStatus.ACTIVE,
                    started_at=now,
                    expires_at=now + timedelta(days=30),
                ),
            ]
        )
        session.flush()

        users = {
            "owner": owner,
            "customer": customer,
            "unlimited": unlimited_customer,
            "no_subscription": no_subscription_customer,
        }
        tokens = {
            name: create_token(
                str(user.id),
                "access",
                datetime.now(UTC) + timedelta(minutes=10),
            )[0]
            for name, user in users.items()
        }
        values = {
            "shop_id": shop.id,
            "product_id": product.id,
            "customer_id": customer.id,
            "unlimited_id": unlimited_customer.id,
            "tokens": tokens,
            "session_factory": test_session,
        }

    try:
        with TestClient(app) as client:
            yield {"client": client, **values}
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_order(api: dict[str, object], token: str):
    client = api["client"]
    return client.post(
        "/api/v1/orders",
        headers=_auth(token),
        json={"shop_id": api["shop_id"], "product_id": api["product_id"]},
    )


def test_order_requires_active_subscription_and_deducts_one_credit(
    order_api: dict[str, object],
) -> None:
    tokens = order_api["tokens"]
    denied = _create_order(order_api, tokens["no_subscription"])
    assert denied.status_code == 403
    assert "Aktif aboneliğiniz yok" in denied.json()["detail"]

    created = _create_order(order_api, tokens["customer"])
    assert created.status_code == 201
    assert created.json()["remaining_credits"] == 0

    exhausted = _create_order(order_api, tokens["customer"])
    assert exhausted.status_code == 409
    assert "Kahve hakkınız bitmiş" in exhausted.json()["detail"]


def test_shop_owner_progress_and_signed_qr_delivery(
    order_api: dict[str, object],
) -> None:
    tokens = order_api["tokens"]
    created = _create_order(order_api, tokens["customer"])
    assert created.status_code == 201
    order = created.json()
    qr_payload = order["qr_code"]["payload"]
    assert set(qr_payload) == {
        "order_id",
        "user_id",
        "shop_id",
        "created_at",
        "signature",
    }

    order_id = order["id"]
    client = order_api["client"]
    owner_headers = _auth(tokens["owner"])
    for next_status in ("ACCEPTED", "PREPARING", "READY"):
        response = client.patch(
            f"/api/v1/orders/{order_id}/status",
            headers=owner_headers,
            json={"status": next_status},
        )
        assert response.status_code == 200

    forged_payload = {**qr_payload, "signature": "0" * 64}
    forged = client.post(
        "/api/v1/orders/verify-qr",
        headers=owner_headers,
        json=forged_payload,
    )
    assert forged.status_code == 400

    async def verify_and_receive_event():
        subscription = order_status_events.subscribe(order_id)
        try:
            response = client.post(
                "/api/v1/orders/verify-qr",
                headers=owner_headers,
                json=qr_payload,
            )
            event = await asyncio.wait_for(subscription.queue.get(), timeout=1)
            return response, event
        finally:
            order_status_events.unsubscribe(subscription)

    delivered, delivery_event = asyncio.run(verify_and_receive_event())
    assert delivered.status_code == 200
    assert delivered.json()["valid"] is True
    assert delivered.json()["status"] == "DELIVERED"
    assert delivery_event["status"] == "DELIVERED"

    repeated_scan = client.post(
        "/api/v1/orders/verify-qr",
        headers=owner_headers,
        json=qr_payload,
    )
    assert repeated_scan.status_code == 409


def test_order_status_change_is_published_to_subscribers(
    order_api: dict[str, object],
) -> None:
    created = _create_order(order_api, order_api["tokens"]["customer"])
    assert created.status_code == 201
    order_id = created.json()["id"]
    client = order_api["client"]
    owner_headers = _auth(order_api["tokens"]["owner"])

    async def update_and_receive_event():
        subscription = order_status_events.subscribe(order_id)
        try:
            response = client.patch(
                f"/api/v1/orders/{order_id}/status",
                headers=owner_headers,
                json={"status": "ACCEPTED"},
            )
            event = await asyncio.wait_for(subscription.queue.get(), timeout=1)
            return response, event
        finally:
            order_status_events.unsubscribe(subscription)

    response, event = asyncio.run(update_and_receive_event())

    assert response.status_code == 200
    assert event == {
        "order_id": order_id,
        "status": "ACCEPTED",
        "status_label": "Kabul Edildi",
    }


def test_order_status_stream_checks_order_access(
    order_api: dict[str, object],
) -> None:
    created = _create_order(order_api, order_api["tokens"]["customer"])
    assert created.status_code == 201
    order_id = created.json()["id"]
    client = order_api["client"]

    unauthenticated = client.get(f"/api/v1/orders/{order_id}/events")
    forbidden = client.get(
        f"/api/v1/orders/{order_id}/events",
        headers=_auth(order_api["tokens"]["no_subscription"]),
    )

    assert unauthenticated.status_code == 401
    assert forbidden.status_code == 403


def test_shop_owner_order_list_is_role_protected_and_includes_customer_info(
    order_api: dict[str, object],
) -> None:
    created = _create_order(order_api, order_api["tokens"]["customer"])
    assert created.status_code == 201

    client = order_api["client"]
    customer_response = client.get(
        "/api/v1/orders/shop-owner",
        headers=_auth(order_api["tokens"]["customer"]),
    )
    assert customer_response.status_code == 403

    owner_response = client.get(
        "/api/v1/orders/shop-owner",
        headers=_auth(order_api["tokens"]["owner"]),
    )
    assert owner_response.status_code == 200
    owner_orders = owner_response.json()
    assert len(owner_orders) == 1
    assert owner_orders[0]["customer_name"] == "Coffee Customer"
    assert owner_orders[0]["customer_phone"] == "+905550001002"
    assert owner_orders[0]["status"] == "PENDING"
    assert owner_orders[0]["product_name"] == "Espresso"


def test_unlimited_subscription_keeps_unlimited_balance(
    order_api: dict[str, object],
) -> None:
    created = _create_order(order_api, order_api["tokens"]["unlimited"])
    assert created.status_code == 201
    assert created.json()["remaining_credits"] is None

    with order_api["session_factory"]() as session:
        subscription = session.scalar(
            select(Subscription).where(
                Subscription.user_id == order_api["unlimited_id"]
            )
        )
        assert subscription.remaining_credits is None
        assert subscription.credits_used == 1
