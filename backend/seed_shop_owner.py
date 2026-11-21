from seed_data import DEMO_SHOP_OWNER_PHONE, prepare_database, seed_shop_owner
from app.db.session import SessionLocal


def main() -> None:
    prepare_database()
    with SessionLocal() as session:
        with session.begin():
            seed_shop_owner(session)
    print(f"Dükkân sahibi test hesabı hazır: {DEMO_SHOP_OWNER_PHONE} (OTP: 1234).")


if __name__ == "__main__":
    main()
