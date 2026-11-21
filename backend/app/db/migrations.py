from sqlalchemy import inspect
from sqlalchemy import text
from uuid import uuid4

from app.db.session import engine


def apply_sqlite_migrations() -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        tables = set(inspector.get_table_names())
        if "subscriptions" in tables:
            columns = {
                column["name"]
                for column in inspector.get_columns("subscriptions")
            }
            if "credits_used" not in columns:
                connection.exec_driver_sql(
                    "ALTER TABLE subscriptions "
                    "ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0"
                )

        for table in ("users", "shops"):
            if table not in tables:
                continue
            columns = {
                column["name"] for column in inspect(connection).get_columns(table)
            }
            if "public_id" not in columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE {table} ADD COLUMN public_id VARCHAR(36)"
                )
            rows = connection.execute(
                text(f"SELECT id FROM {table} WHERE public_id IS NULL")
            ).scalars().all()
            for row_id in rows:
                connection.execute(
                    text(f"UPDATE {table} SET public_id = :public_id WHERE id = :id"),
                    {"public_id": str(uuid4()), "id": row_id},
                )
            connection.exec_driver_sql(
                f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_public_id "
                f"ON {table}(public_id)"
            )
