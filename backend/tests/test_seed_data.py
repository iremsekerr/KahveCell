from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models import Base, Shop, User
from seed_data import (
    DEMO_PHONE,
    DEMO_SHOP_OWNER_PHONE,
    SHOP_SEEDS,
    seed_demo_account,
    seed_shop_owner,
    seed_shops,
)


def test_demo_account_uses_otp_without_a_fixed_password() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            seed_demo_account(session)
            demo_user = session.scalar(
                select(User).where(User.phone_number == DEMO_PHONE)
            )
            assert demo_user is not None
            assert demo_user.password_hash is None
    finally:
        engine.dispose()


def test_demo_shop_owner_owns_all_seed_shops() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            seed_shops(session)
            seed_shop_owner(session)

            owner = session.scalar(
                select(User).where(User.phone_number == DEMO_SHOP_OWNER_PHONE)
            )
            assert owner is not None
            owned_shop_names = set(
                session.scalars(
                    select(Shop.name).where(Shop.owner_id == owner.id)
                )
            )

        assert owned_shop_names == {shop["name"] for shop in SHOP_SEEDS}
    finally:
        engine.dispose()
