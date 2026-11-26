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
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TenantMixin
from .payment import PAYMENT_METHODS


class Supplier(TenantMixin, Base):
    """A firm (or person) the company buys goods from. Its own list, apart from customers: what
    customers owe us and what we owe suppliers are counted separately, and a firm that is both
    is entered in both."""

    name: Mapped[str]
    inn: Mapped[str | None] = mapped_column(String(14))  # ИНН (9) or ПИНФЛ (14)
    phone: Mapped[str | None]
    address: Mapped[str | None]
    note: Mapped[str | None]
    # filled from the fields above by app.core.text; see SupplierManager
    search: Mapped[str]
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def archived(self) -> bool:
        return self.archived_at is not None

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "inn"),
        # lets receipts and payments point at (id, tenant_id): never another company's supplier
        UniqueConstraint("id", "tenant_id"),
        Index(
            "ix_supplier_search",
            "search",
            postgresql_using="gin",
            postgresql_ops={"search": "gin_trgm_ops"},
        ),
    )


class SupplierPayment(TenantMixin, Base):
    """Money paid to a supplier. It lowers what we owe them in its own currency. Never edited:
    a wrong one is cancelled (it stays in the history and stops counting) and entered again.
    """

    number: Mapped[int] = mapped_column(Integer)
    date: Mapped[date] = mapped_column(Date)
    supplier_id: Mapped[int] = mapped_column(BigInteger)
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
            ["supplier_id", "tenant_id"], ["supplier.id", "supplier.tenant_id"]
        ),
        Index("ix_supplier_payment_tenant_supplier", "tenant_id", "supplier_id"),
        Index("ix_supplier_payment_tenant_date", "tenant_id", "date"),
    )
