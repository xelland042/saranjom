from sqlalchemy import BigInteger, ForeignKeyConstraint, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TenantMixin

ENTITIES = (
    "customer",
    "order",
    "payment",
    "task",
    "product",
    "stock_document",
    "return",
    "supplier",
    "supplier_payment",
)


class Activity(TenantMixin, Base):
    """What happened, by whom and when: a record's history and a customer's timeline. Written in
    the same transaction as the change, never edited. A note is an activity with `text` (typed by
    a person: "called, promises to pay on Friday"); only notes can be deleted, by their author.
    """

    entity: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    # created, updated, confirmed, cancelled, archived, restored, done, reopened, deleted, note...
    action: Mapped[str] = mapped_column(String(20))
    # the customer it concerns, so their timeline gathers their orders, payments and tasks too
    customer_id: Mapped[int | None] = mapped_column(BigInteger)
    user_id: Mapped[int | None] = mapped_column(BigInteger)
    text: Mapped[str | None]
    # what's needed to show it without reading the record (which may have changed since):
    # {"number": 6, "total": "8860000.00", "currency": "UZS", "changes": {"phone": [old, new]}}
    data: Mapped[dict | None] = mapped_column(JSONB)

    __table_args__ = (
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"], ["customer.id", "customer.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["user_id", "tenant_id"],
            ["app_user.id", "app_user.tenant_id"],
            ondelete="SET NULL (user_id)",
        ),
        Index("ix_activity_customer", "tenant_id", "customer_id", "id"),
        Index("ix_activity_entity", "tenant_id", "entity", "entity_id", "id"),
    )
