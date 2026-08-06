from sqlalchemy import Column, Integer, String, JSON, DateTime, ForeignKey, func
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    flows = relationship("Flow", back_populates="owner", cascade="all, delete-orphan")


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
