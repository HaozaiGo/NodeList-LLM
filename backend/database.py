import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from models import Base

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nodelist.db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)
    migrate_schema()


def migrate_schema():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "users" not in table_names:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as conn:
        if "role" not in user_columns:
            if engine.dialect.name == "sqlite":
                conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR NOT NULL DEFAULT 'user'"))
            else:
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR NOT NULL DEFAULT 'user'"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_role ON users (role)"))

        if "credit_balance" not in user_columns:
            if engine.dialect.name == "sqlite":
                conn.execute(text("ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 0"))
            else:
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS credit_balance INTEGER NOT NULL DEFAULT 0"))

        if "disabled_at" not in user_columns:
            if engine.dialect.name == "sqlite":
                conn.execute(text("ALTER TABLE users ADD COLUMN disabled_at DATETIME"))
            else:
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP"))

        admin_emails = [email.strip().lower() for email in os.getenv("ADMIN_EMAILS", "").split(",") if email.strip()]
        for email in admin_emails:
            conn.execute(text("UPDATE users SET role = 'admin' WHERE lower(email) = :email"), {"email": email})

        admin_count = conn.execute(text("SELECT COUNT(*) FROM users WHERE role = 'admin'")).scalar() or 0
        if admin_count == 0:
            first_user_id = conn.execute(text("SELECT id FROM users ORDER BY created_at LIMIT 1")).scalar()
            if first_user_id:
                conn.execute(text("UPDATE users SET role = 'admin' WHERE id = :user_id"), {"user_id": first_user_id})

        if "flows" not in table_names:
            return

        flow_columns = {column["name"] for column in inspector.get_columns("flows")}
        if "user_id" not in flow_columns:
            if engine.dialect.name == "sqlite":
                conn.execute(text("ALTER TABLE flows ADD COLUMN user_id VARCHAR"))
            else:
                conn.execute(text("ALTER TABLE flows ADD COLUMN IF NOT EXISTS user_id VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_flows_user_id ON flows (user_id)"))

        first_user_id = conn.execute(text("SELECT id FROM users ORDER BY created_at LIMIT 1")).scalar()
        if first_user_id:
            conn.execute(
                text("UPDATE flows SET user_id = :user_id WHERE user_id IS NULL"),
                {"user_id": first_user_id},
            )

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_assets_user_id ON assets (user_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_assets_flow_id ON assets (flow_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_assets_node_id ON assets (node_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_assets_kind ON assets (kind)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_assets_remote_id ON assets (remote_id)"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
