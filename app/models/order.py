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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TenantMixin

ORDER_STATUSES = ("draft", "confirmed", "cancelled")


class VatRate(TenantMixin, Base):
    """The company's VAT (QQS) rate from a date on: dated data, never a constant, because rates
    and a company's tax regime change. No row on a date means no VAT then (turnover-tax payers).
    """

    rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2)
    )  # percent, e.g. 12.00; 0 = none
    valid_from: Mapped[date] = mapped_column(Date)

    __table_args__ = (
        UniqueConstraint("tenant_id", "valid_from"),
        CheckConstraint("rate >= 0 AND rate < 100", name="rate_range"),
    )


class SalesOrder(TenantMixin, Base):
    """A sale to a customer. A draft can be edited freely; confirming takes its goods out of the
    warehouse and freezes it; cancelling a confirmed order puts the goods back and keeps it in the
    history. Prices include VAT, as usual in Uzbek wholesale; the VAT inside is shown apart.
    """

    number: Mapped[int] = mapped_column(Integer)
    # when it should be paid: the date plus the customer's payment days, set at confirmation
    # (above `date`, which hides the type from here on)
    due_date: Mapped[date | None] = mapped_column(Date)
    date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), server_default="draft")
    customer_id: Mapped[int] = mapped_column(BigInteger, index=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger)
    price_list_id: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))  # the price list's
    # units of the company's main currency per one unit, saved at confirmation
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")
    vat_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")
    note: Mapped[str | None]
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="SET NULL")
    )

    lines: Mapped[list["OrderLine"]] = relationship(
        order_by="OrderLine.id", cascade="all, delete-orphan", passive_deletes=True
    )

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "number"),
        UniqueConstraint("id", "tenant_id"),
        CheckConstraint(f"status IN {ORDER_STATUSES}", name="status"),
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"], ["customer.id", "customer.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["warehouse_id", "tenant_id"], ["warehouse.id", "warehouse.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["price_list_id", "tenant_id"], ["price_list.id", "price_list.tenant_id"]
        ),
        Index("ix_sales_order_tenant_date", "tenant_id", "date"),
    )


class OrderLine(TenantMixin, Base):
    order_id: Mapped[int] = mapped_column(BigInteger, index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 2))  # per unit, VAT included
    discount: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="0")  # %
    amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2)
    )  # after discount, VAT included
    vat_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), server_default="0")
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("price >= 0", name="price_positive"),
        CheckConstraint("discount >= 0 AND discount <= 100", name="discount_range"),
        UniqueConstraint("id", "tenant_id"),  # for return lines' foreign key
        ForeignKeyConstraint(
            ["order_id", "tenant_id"],
            ["sales_order.id", "sales_order.tenant_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["product_id", "tenant_id"], ["product.id", "product.tenant_id"]
        ),
    )


class SalesReturn(TenantMixin, Base):
    """Goods a customer brought back from a confirmed order: they go back into a warehouse and
    the customer owes that much less. Posted when saved and never edited, like stock documents:
    cancelling one takes the goods out again and brings the debt back. Amounts are the order's
    own (price, discount and VAT), so a return undoes exactly that part of the sale; the exchange
    rate is the order's too."""

    number: Mapped[int] = mapped_column(Integer)
    date: Mapped[date] = mapped_column(Date)
    order_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # the order's, kept here so debts and the history read it without a join
    customer_id: Mapped[int] = mapped_column(BigInteger, index=True)
    warehouse_id: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    vat_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")
    note: Mapped[str | None]
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="SET NULL")
    )

    lines: Mapped[list["ReturnLine"]] = relationship(
        order_by="ReturnLine.id", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def cancelled(self) -> bool:
        return self.cancelled_at is not None

    __table_args__ = (
        UniqueConstraint("tenant_id", "number"),
        UniqueConstraint("id", "tenant_id"),
        ForeignKeyConstraint(
            ["order_id", "tenant_id"], ["sales_order.id", "sales_order.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"], ["customer.id", "customer.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["warehouse_id", "tenant_id"], ["warehouse.id", "warehouse.tenant_id"]
        ),
        Index("ix_sales_return_tenant_date", "tenant_id", "date"),
    )


class ReturnLine(TenantMixin, Base):
    return_id: Mapped[int] = mapped_column(BigInteger, index=True)
    order_line_id: Mapped[int] = mapped_column(BigInteger, index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))  # VAT included
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        ForeignKeyConstraint(
            ["return_id", "tenant_id"],
            ["sales_return.id", "sales_return.tenant_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["order_line_id", "tenant_id"], ["order_line.id", "order_line.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["product_id", "tenant_id"], ["product.id", "product.tenant_id"]
        ),
    )
