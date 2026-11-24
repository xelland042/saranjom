from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TenantMixin

# Units a product is counted in. Codes are stored; each language names them (frontend i18n).
UNITS = (
    "pcs",
    "kg",
    "g",
    "t",
    "l",
    "m",
    "m2",
    "m3",
    "box",
    "pack",
    "bag",
    "set",
    "roll",
)


class ProductCategory(TenantMixin, Base):
    name: Mapped[str]

    __table_args__ = (
        UniqueConstraint("tenant_id", "name"),
        UniqueConstraint("id", "tenant_id"),
    )


class PriceList(TenantMixin, Base):
    """A named set of prices in one currency ("Ulgurji" in USD, "Chakana" in soʻm), like 1C's виды цен.
    Every company has exactly one default list; customers without a list buy at it."""

    name: Mapped[str]
    currency: Mapped[str] = mapped_column(String(3))  # ISO 4217; fixed once created
    is_default: Mapped[bool] = mapped_column(Boolean, server_default="false")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def archived(self) -> bool:
        return self.archived_at is not None

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "name"),
        UniqueConstraint("id", "tenant_id"),
        # at most one default per company
        Index(
            "uq_price_list_default",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )


class Product(TenantMixin, Base):
    name: Mapped[str]
    sku: Mapped[str | None]  # the firm's own article code
    barcode: Mapped[str | None]
    unit: Mapped[str] = mapped_column(String(8))
    category_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    mxik: Mapped[str | None] = mapped_column(
        String(17)
    )  # МХИК (ИКПУ), needed on e-invoices
    note: Mapped[str | None]
    # below this in all warehouses together, the product shows as running low; none: no alert
    min_stock: Mapped[Decimal | None] = mapped_column(Numeric(18, 3))
    name_key: Mapped[str]
    search: Mapped[str]
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    prices: Mapped[list["ProductPrice"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def archived(self) -> bool:
        return self.archived_at is not None

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku"),
        UniqueConstraint("tenant_id", "barcode"),
        UniqueConstraint("id", "tenant_id"),
        # (category_id, tenant_id): a product can't use another company's category.
        # Deleting a category clears it from its products.
        ForeignKeyConstraint(
            ["category_id", "tenant_id"],
            ["product_category.id", "product_category.tenant_id"],
            ondelete="SET NULL (category_id)",
        ),
        Index(
            "ix_product_search",
            "search",
            postgresql_using="gin",
            postgresql_ops={"search": "gin_trgm_ops"},
        ),
        Index(
            "ix_product_name_key",
            "name_key",
            postgresql_using="gin",
            postgresql_ops={"name_key": "gin_trgm_ops"},
        ),
    )


class ProductPrice(TenantMixin, Base):
    product_id: Mapped[int] = mapped_column(BigInteger)
    price_list_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # in the price list's currency; NUMERIC, never float
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))

    __table_args__ = (
        UniqueConstraint("product_id", "price_list_id"),
        ForeignKeyConstraint(
            ["product_id", "tenant_id"],
            ["product.id", "product.tenant_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["price_list_id", "tenant_id"],
            ["price_list.id", "price_list.tenant_id"],
            ondelete="CASCADE",
        ),
    )
