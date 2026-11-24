from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TenantMixin

# receipt: goods arrive in a warehouse; write_off: goods leave it (damaged, used, lost);
# transfer: goods move from one warehouse to another. Sales will move stock through orders.
DOCUMENT_KINDS = ("receipt", "write_off", "transfer")


class Warehouse(TenantMixin, Base):
    """A place goods are kept: a warehouse, a shop, a delivery van. Every company has exactly one
    default warehouse."""

    name: Mapped[str]
    is_default: Mapped[bool] = mapped_column(Boolean, server_default="false")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def archived(self) -> bool:
        return self.archived_at is not None

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "name"),
        UniqueConstraint("id", "tenant_id"),
        Index(
            "uq_warehouse_default",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )


class DocumentCounter(TenantMixin, Base):
    """The last number given to each kind of document in a company (K-0001, K-0002, ...).
    Incremented in one upsert, so two people saving at once can't get the same number.
    """

    kind: Mapped[str] = mapped_column(String(16))
    last: Mapped[int] = mapped_column(Integer)

    __table_args__ = (UniqueConstraint("tenant_id", "kind"),)


class StockDocument(TenantMixin, Base):
    """A posted stock movement. Never edited: a mistake is undone by cancelling it (it stays in
    the history and stops counting) and entering a new one. Stock balances are the sum of the
    posted documents' lines, so there is no separate balance to keep in step."""

    kind: Mapped[str] = mapped_column(String(16))
    number: Mapped[int] = mapped_column(Integer)
    date: Mapped[date] = mapped_column(Date)
    # receipt: where goods arrive; write_off and transfer: where they leave from
    warehouse_id: Mapped[int] = mapped_column(BigInteger)
    to_warehouse_id: Mapped[int | None] = mapped_column(BigInteger)  # transfer only
    currency: Mapped[str | None] = mapped_column(String(3))  # of the receipt's prices
    note: Mapped[str | None]
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="SET NULL")
    )

    lines: Mapped[list["StockLine"]] = relationship(
        order_by="StockLine.id", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def cancelled(self) -> bool:
        return self.cancelled_at is not None

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "kind", "number"),
        UniqueConstraint("id", "tenant_id"),
        CheckConstraint(f"kind IN {DOCUMENT_KINDS}", name="kind"),
        CheckConstraint(
            "(kind = 'transfer') = (to_warehouse_id IS NOT NULL)"
            " AND to_warehouse_id IS DISTINCT FROM warehouse_id",
            name="transfer_target",
        ),
        ForeignKeyConstraint(
            ["warehouse_id", "tenant_id"], ["warehouse.id", "warehouse.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["to_warehouse_id", "tenant_id"], ["warehouse.id", "warehouse.tenant_id"]
        ),
        Index("ix_stock_document_tenant_date", "tenant_id", "date"),
    )


class StockLine(TenantMixin, Base):
    document_id: Mapped[int] = mapped_column(BigInteger, index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # always positive; the document's kind says which way it moves (kg need decimals)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))  # receipts, optional

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        ForeignKeyConstraint(
            ["document_id", "tenant_id"],
            ["stock_document.id", "stock_document.tenant_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["product_id", "tenant_id"], ["product.id", "product.tenant_id"]
        ),
    )
