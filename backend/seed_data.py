from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.migrations import apply_sqlite_migrations
from app.db.session import SessionLocal, engine
from app.models import (
    PlanType,
    Product,
    Shop,
    Subscription,
    SubscriptionStatus,
    User,
    UserRole,
)

DEMO_PHONE = "+905550000001"
DEMO_SHOP_OWNER_PHONE = "+905550000002"

SHOP_SEEDS = [
    {
        "name": "KahveCell Kızılay",
        "address": "Kızılay Meydanı çevresi, Kızılay, Çankaya, Ankara",
        "latitude": 39.9208,
        "longitude": 32.8541,
        "rating": 4.4,
        "prices": ("130.00", "165.00", "190.00", "145.00"),
    },
    {
        "name": "Yedinci Cadde Kahve",
        "address": "7. Cadde, Bahçelievler, Çankaya, Ankara",
        "latitude": 39.9225,
        "longitude": 32.8223,
        "rating": 4.5,
        "prices": ("125.00", "160.00", "185.00", "140.00"),
    },
    {
        "name": "Tunalı Kahve Atölyesi",
        "address": "Tunalı Hilmi Caddesi, Kavaklıdere, Çankaya, Ankara",
        "latitude": 39.9092,
        "longitude": 32.8616,
        "rating": 4.6,
        "prices": ("145.00", "180.00", "205.00", "155.00"),
    },
    {
        "name": "Çayyolu Demleme Evi",
        "address": "Arcadium AVM çevresi, Çayyolu, Çankaya, Ankara",
        "latitude": 39.8877,
        "longitude": 32.6865,
        "rating": 4.3,
        "prices": ("140.00", "175.00", "200.00", "150.00"),
    },
    {
        "name": "Ulus Tarihi Kahve",
        "address": "Anafartalar Caddesi, Ulus, Altındağ, Ankara",
        "latitude": 39.9415,
        "longitude": 32.8550,
        "rating": 4.2,
        "prices": ("115.00", "150.00", "175.00", "130.00"),
    },
]

PRODUCTS = (
    ("Espresso", "Espresso", 0),
    ("Americano", "Filtre Kahve", 1),
    ("Cappuccino", "Sütlü Kahve", 2),
    ("Türk Kahvesi", "Geleneksel Kahve", 3),
)


def prepare_database() -> None:
    Base.metadata.create_all(bind=engine)
    apply_sqlite_migrations()
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    if "password_hash" not in user_columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)")
            )


def seed_shops(session: Session) -> None:
    for shop_data in SHOP_SEEDS:
        shop = session.scalar(
            select(Shop).where(Shop.name == shop_data["name"])
        )
        if shop is None:
            shop = Shop(name=shop_data["name"])
            session.add(shop)

        shop.address = shop_data["address"]
        shop.latitude = shop_data["latitude"]
        shop.longitude = shop_data["longitude"]
        shop.rating = shop_data["rating"]
        shop.working_hours = {"weekdays": "08:00-22:00", "weekends": "09:00-22:00"}
        session.flush()

        for product_name, category, price_index in PRODUCTS:
            product = session.scalar(
                select(Product).where(
                    Product.shop_id == shop.id,
                    Product.name == product_name,
                )
            )
            if product is None:
                product = Product(shop_id=shop.id, name=product_name)
                session.add(product)
            product.category = category
            product.description = f"{product_name} kahvesi"
            product.price = Decimal(shop_data["prices"][price_index])
            product.is_available = True


def seed_demo_account(session: Session) -> None:
    user = session.scalar(select(User).where(User.phone_number == DEMO_PHONE))
    if user is None:
        user = User(phone_number=DEMO_PHONE)
        session.add(user)

    user.first_name = "Demo"
    user.last_name = "Kullanıcı"
    user.role = UserRole.CUSTOMER
    user.password_hash = None
    session.flush()

    now = datetime.now(UTC)
    active_subscriptions = list(
        session.scalars(
            select(Subscription).where(
                Subscription.user_id == user.id,
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
        )
    )
    subscription = active_subscriptions[0] if active_subscriptions else Subscription(
        user_id=user.id
    )
    for duplicate in active_subscriptions[1:]:
        duplicate.status = SubscriptionStatus.CANCELLED

    subscription.plan_type = PlanType.STARTER
    subscription.monthly_price = Decimal("89.99")
    subscription.monthly_coffee_limit = 10
    subscription.remaining_credits = 10
    subscription.guest_credits = 0
    subscription.status = SubscriptionStatus.ACTIVE
    subscription.started_at = now
    subscription.expires_at = now + timedelta(days=30)
    session.add(subscription)


def seed_shop_owner(session: Session) -> None:
    owner = session.scalar(
        select(User).where(User.phone_number == DEMO_SHOP_OWNER_PHONE)
    )
    if owner is None:
        owner = User(phone_number=DEMO_SHOP_OWNER_PHONE)
        session.add(owner)

    owner.first_name = "Dükkan"
    owner.last_name = "Sahibi"
    owner.role = UserRole.SHOP_OWNER
    session.flush()

    shop_names = [shop_data["name"] for shop_data in SHOP_SEEDS]
    shops = list(session.scalars(select(Shop).where(Shop.name.in_(shop_names))))
    if len(shops) != len(SHOP_SEEDS):
        raise RuntimeError("Tüm seed dükkânları bulunamadı.")
    for shop in shops:
        shop.owner_id = owner.id


def main() -> None:
    prepare_database()
    with SessionLocal() as session:
        with session.begin():
            seed_shops(session)
            seed_demo_account(session)
            seed_shop_owner(session)

    print(f"Seed tamamlandı: {len(SHOP_SEEDS)} Ankara dükkânı, her birinde 4 ürün.")
    print(f"Demo telefon: {DEMO_PHONE}")
    print("Aktif abonelik: Starter (10 kahve, 89,99 TL).")
    print(f"Dükkân sahibi test telefonu: {DEMO_SHOP_OWNER_PHONE} (OTP: 1234).")


if __name__ == "__main__":
    main()
