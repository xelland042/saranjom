from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TenantMixin

PAYMENT_METHODS = ("cash", "transfer", "card", "online")


class Payment(TenantMixin, Base):
    """Money received from a customer. It lowers their debt in its own currency. Never edited:
    a wrong one is cancelled (it stays in the history and stops counting) and entered again.
    """

    number: Mapped[int] = mapped_column(Integer)
    date: Mapped[date] = mapped_column(Date)
    customer_id: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    # units of the company's main currency per one unit, saved when entered
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    method: Mapped[str] = mapped_column(String(16))
    note: Mapped[str | None]
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="SET NULL")
    )

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "number"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(f"method IN {PAYMENT_METHODS}", name="method"),
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"], ["customer.id", "customer.tenant_id"]
        ),
        Index("ix_payment_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_payment_tenant_date", "tenant_id", "date"),
    )


class OpeningBalance(TenantMixin, Base):
    """What a customer already owed (or had paid ahead, when negative) on the day the company
    started using Saranjom: one per customer and currency, typed in once from the old records.
    """

    customer_id: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    date: Mapped[date] = mapped_column(Date)

    __table_args__ = (
        UniqueConstraint("tenant_id", "customer_id", "currency"),
        CheckConstraint("amount <> 0", name="amount_not_zero"),
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"], ["customer.id", "customer.tenant_id"]
        ),
    )
