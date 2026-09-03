from sqlalchemy import Column, Integer, String, JSON, DateTime, ForeignKey, func
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    google_sub = Column(String, unique=True, nullable=True, index=True)
    role = Column(String, nullable=False, default="user", server_default="user", index=True)
    credit_balance = Column(Integer, nullable=False, default=0, server_default="0")
    disabled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    flows = relationship("Flow", back_populates="owner", cascade="all, delete-orphan")
    credit_transactions = relationship(
        "CreditTransaction",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="CreditTransaction.user_id",
    )


class Flow(Base):
    __tablename__ = "flows"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, default="Untitled Flow")
    nodes = Column(JSON, nullable=False, default=list)
    edges = Column(JSON, nullable=False, default=list)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    owner = relationship("User", back_populates="flows")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    flow_id = Column(String, ForeignKey("flows.id"), nullable=True, index=True)
    node_id = Column(String, nullable=True, index=True)
    kind = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)
    storage_key = Column(String, nullable=False)
    public_url = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    provider = Column(String, nullable=False, default="local")
    remote_id = Column(String, nullable=True, index=True)
    asset_metadata = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime, server_default=func.now())


class BillingConfig(Base):
    __tablename__ = "billing_config"

    id = Column(String, primary_key=True, default="default")
    image_cost = Column(Integer, nullable=False, default=0, server_default="0")
    video_cost = Column(Integer, nullable=False, default=0, server_default="0")
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class BrandingConfig(Base):
    __tablename__ = "branding_config"

    id = Column(String, primary_key=True, default="default")
    name = Column(String, nullable=False, default="NodeList AI", server_default="NodeList AI")
    logo_storage_key = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    logo_mime_type = Column(String, nullable=True)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    admin_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    transaction_type = Column(String, nullable=False, default="manual_adjustment", index=True)
    note = Column(String, nullable=False, default="")
    created_at = Column(DateTime, server_default=func.now(), index=True)

    user = relationship("User", foreign_keys=[user_id], back_populates="credit_transactions")
    admin = relationship("User", foreign_keys=[admin_id])
