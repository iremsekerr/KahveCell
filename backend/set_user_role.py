import argparse

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import User, UserRole
from app.schemas.auth import normalize_phone_number


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Yerel geliştirme için kayıtlı kullanıcının rolünü değiştirir."
    )
    parser.add_argument("phone_number", help="Kullanıcının GSM numarası")
    parser.add_argument("role", choices=[role.value for role in UserRole])
    arguments = parser.parse_args()

    phone_number = normalize_phone_number(arguments.phone_number)
    with SessionLocal() as session:
        user = session.scalar(
            select(User).where(User.phone_number == phone_number)
        )
        if user is None:
            parser.error("Bu numarayla kayıtlı kullanıcı bulunamadı.")
        user.role = UserRole(arguments.role)
        session.commit()
        print(f"{user.phone_number} kullanıcısının rolü {user.role.value} oldu.")


if __name__ == "__main__":
    main()
