from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TenantMixin


class Customer(TenantMixin, Base):
    """A firm (or person) the company sells to."""

    name: Mapped[str]
    inn: Mapped[str | None] = mapped_column(String(14))  # ИНН (9) or ПИНФЛ (14)
    phone: Mapped[str | None]
    address: Mapped[str | None]
    note: Mapped[str | None]
    # the price list this customer buys at; none means the company's default
    price_list_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    # days to pay after a confirmed order; none means on the day
    payment_days: Mapped[int | None] = mapped_column(SmallInteger)
    # confirming an order that takes the debt in this currency above the limit warns (never blocks)
    credit_limit: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    credit_currency: Mapped[str | None] = mapped_column(String(3))
    # filled from the fields above by app.core.text; see CustomerManager
    name_key: Mapped[str]
    search: Mapped[str]
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    contacts: Mapped[list["CustomerContact"]] = relationship(
        order_by="CustomerContact.id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @property
    def archived(self) -> bool:
        return self.archived_at is not None

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "inn"),
        CheckConstraint("payment_days BETWEEN 0 AND 365", name="payment_days_range"),
        CheckConstraint(
            "credit_limit >= 0 AND (credit_limit IS NULL) = (credit_currency IS NULL)",
            name="credit_limit",
        ),
        # lets contacts point at (id, tenant_id), so a contact can't join another company's customer
        UniqueConstraint("id", "tenant_id"),
        ForeignKeyConstraint(
            ["price_list_id", "tenant_id"],
            ["price_list.id", "price_list.tenant_id"],
            ondelete="SET NULL (price_list_id)",
        ),
        Index(
            "ix_customer_search",
            "search",
            postgresql_using="gin",
            postgresql_ops={"search": "gin_trgm_ops"},
        ),
        Index(
            "ix_customer_name_key",
            "name_key",
            postgresql_using="gin",
            postgresql_ops={"name_key": "gin_trgm_ops"},
        ),
    )


class CustomerContact(TenantMixin, Base):
    """A person at a customer: who to call."""

    customer_id: Mapped[int] = mapped_column(BigInteger, index=True)
    name: Mapped[str]
    phone: Mapped[str | None]
    position: Mapped[str | None]  # job title
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"],
            ["customer.id", "customer.tenant_id"],
            ondelete="CASCADE",
        ),
    )
