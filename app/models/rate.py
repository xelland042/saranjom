from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TenantMixin


class CbuRate(Base):
    """The Central Bank of Uzbekistan's official rate: soʻm for one unit of a currency, from a date.
    Public data shared by every company, so no tenant_id and no row-level security."""

    currency: Mapped[str] = mapped_column(String(3))
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    date: Mapped[date] = mapped_column(Date)

    __table_args__ = (UniqueConstraint("currency", "date"),)


class CompanyRate(TenantMixin, Base):
    """A company's own rate for a currency (many wholesalers use the market rate, not the
    Central Bank's): units of the company's main currency for one unit. Replaces the official
    rate for that company until removed."""

    currency: Mapped[str] = mapped_column(String(3))
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (UniqueConstraint("tenant_id", "currency"),)
