from datetime import datetime, timezone

from sqlalchemy import (Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text,
                        create_engine)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; treat them as UTC."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


_kwargs = {"pool_pre_ping": True}
if settings.database_url.startswith("sqlite"):
    _kwargs["connect_args"] = {"check_same_thread": False}
engine = create_engine(settings.database_url, **_kwargs)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, default="")
    category: Mapped[str] = mapped_column(String(30), index=True)
    severity: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), index=True, default="new")
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    ward_no: Mapped[int] = mapped_column(Integer, index=True)
    ward_name: Mapped[str] = mapped_column(String(60))
    zone: Mapped[str] = mapped_column(String(30), index=True)
    department: Mapped[str] = mapped_column(String(80), index=True)
    ai_source: Mapped[str] = mapped_column(String(20), default="manual")
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_observation: Mapped[str] = mapped_column(Text, default="")
    ai_hazard: Mapped[str] = mapped_column(Text, default="")
    citizen_note: Mapped[str] = mapped_column(Text, default="")
    landmark: Mapped[str] = mapped_column(String(200), default="")
    language: Mapped[str] = mapped_column(String(5), default="en")
    complaint_en: Mapped[str] = mapped_column(Text, default="")
    complaint_local: Mapped[str] = mapped_column(Text, default="")
    contact: Mapped[str] = mapped_column(String(120), default="")
    report_count: Mapped[int] = mapped_column(Integer, default=1)
    escalation_level: Mapped[int] = mapped_column(Integer, default=0)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fix_verified: Mapped[str] = mapped_column(String(20), default="")  # "", "ai_yes", "ai_no", "override"
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    photos: Mapped[list["Photo"]] = relationship(back_populates="ticket", order_by="Photo.id")
    events: Mapped[list["Event"]] = relationship(back_populates="ticket", order_by="Event.id")


class Photo(Base):
    __tablename__ = "photos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True, index=True)
    upload_token: Mapped[str] = mapped_column(String(40), index=True, default="")
    kind: Mapped[str] = mapped_column(String(10), default="report")  # report | after
    mime: Mapped[str] = mapped_column(String(30), default="image/jpeg")
    data: Mapped[bytes] = mapped_column(LargeBinary)
    faces_blurred: Mapped[int] = mapped_column(Integer, default=0)
    analysis: Mapped[str] = mapped_column(Text, default="")  # AI result kept server-side until the report is filed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ticket: Mapped[Ticket | None] = relationship(back_populates="photos")


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    actor: Mapped[str] = mapped_column(String(80))  # citizen | agent | system | official email
    kind: Mapped[str] = mapped_column(String(30))
    message: Mapped[str] = mapped_column(Text)
    public: Mapped[bool] = mapped_column(Boolean, default=True)
    ticket: Mapped[Ticket] = relationship(back_populates="events")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20), default="official")  # admin | official
    department: Mapped[str] = mapped_column(String(80), default="")  # "" = all departments
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def init_db() -> None:
    Base.metadata.create_all(engine)
