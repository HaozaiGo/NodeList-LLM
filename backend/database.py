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
    migrate_sqlite_schema()


def migrate_sqlite_schema():
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    if "flows" not in inspector.get_table_names():
        return

    flow_columns = {column["name"] for column in inspector.get_columns("flows")}
    with engine.begin() as conn:
        if "user_id" not in flow_columns:
            conn.execute(text("ALTER TABLE flows ADD COLUMN user_id VARCHAR"))
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
