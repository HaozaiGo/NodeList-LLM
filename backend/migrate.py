"""One-time migration: create users table + add user_id to flows."""
from database import engine
from sqlalchemy import text

with engine.begin() as conn:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS users (
            id VARCHAR PRIMARY KEY,
            email VARCHAR UNIQUE NOT NULL,
            hashed_password VARCHAR NOT NULL,
            created_at TIMESTAMP DEFAULT now()
        )
    """))
    print("users table: OK")

    conn.execute(text("""
        ALTER TABLE flows
        ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE
    """))
    print("flows.user_id column: OK")

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_flows_user_id ON flows(user_id)
    """))
    print("index: OK")

print("Migration complete.")
