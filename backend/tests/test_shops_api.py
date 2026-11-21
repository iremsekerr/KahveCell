from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import get_db
from app.main import app
from app.models import Base, Product, Shop


@pytest.fixture
def client():
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
        kizilay = Shop(
            name="KahveCell Kızılay",
            address="Kızılay Meydanı, Ankara",
            latitude=39.9208,
            longitude=32.8541,
            working_hours={"weekdays": "08:00-22:00"},
            rating=4.5,
        )
        bahcelievler = Shop(
            name="Bahçelievler Kahve",
            address="7. Cadde, Ankara",
            latitude=39.9225,
            longitude=32.8223,
            working_hours={"weekdays": "08:00-22:00"},
            rating=4.3,
        )
        session.add_all([kizilay, bahcelievler])
        session.flush()
        session.add_all(
            [
                Product(
                    shop_id=kizilay.id,
                    name="Cappuccino",
                    category="Sütlü Kahve",
                    price=Decimal("190.00"),
                    is_available=True,
                ),
                Product(
                    shop_id=kizilay.id,
                    name="Latte",
                    category="Sütlü Kahve",
                    price=Decimal("200.00"),
                    is_available=False,
                ),
            ]
        )

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_list_search_and_nearby_sort(client: TestClient) -> None:
    all_shops = client.get("/api/v1/shops")
    assert all_shops.status_code == 200
    assert len(all_shops.json()) == 2

    nearby = client.get(
        "/api/v1/shops",
        params={"lat": 39.9208, "lng": 32.8541},
    )
    assert nearby.status_code == 200
    assert nearby.json()[0]["name"] == "KahveCell Kızılay"
    assert nearby.json()[0]["distance_km"] == 0
    assert nearby.json()[1]["distance_km"] > 0

    search = client.get("/api/v1/shops", params={"q": "Kızılay"})
    assert [shop["name"] for shop in search.json()] == ["KahveCell Kızılay"]


def test_shop_detail_and_menu_only_show_available_products(
    client: TestClient,
) -> None:
    shop = client.get("/api/v1/shops", params={"q": "Kızılay"}).json()[0]
    detail = client.get(f"/api/v1/shops/{shop['id']}")
    assert detail.status_code == 200
    assert [item["name"] for item in detail.json()["menu"]] == ["Cappuccino"]

    menu = client.get(f"/api/v1/shops/{shop['id']}/menu")
    assert menu.status_code == 200
    assert [item["name"] for item in menu.json()] == ["Cappuccino"]
    assert client.get("/api/v1/shops/99999").status_code == 404


def test_location_coordinates_must_be_provided_together(client: TestClient) -> None:
    response = client.get("/api/v1/shops", params={"lat": 39.9208})
    assert response.status_code == 422
