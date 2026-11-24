from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Float,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Index,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TenantMixin

PRIORITIES = ("low", "normal", "high", "urgent")
# colour tokens a board column may take (CSS variables of every look), never free colours
STAGE_COLORS = ("gray", "blue", "accent", "green", "amber", "red", "violet", "gold")
# the columns a new company starts with: (name per language, colour, done)
DEFAULT_STAGES = (
    ({"uz": "Qilinadi", "uz-Cyrl": "Қилинади", "ru": "К выполнению"}, "gray", False),
    ({"uz": "Jarayonda", "uz-Cyrl": "Жараёнда", "ru": "В работе"}, "blue", False),
    ({"uz": "Bajarildi", "uz-Cyrl": "Бажарилди", "ru": "Готово"}, "green", True),
)


class TaskStage(TenantMixin, Base):
    """A column of the task board, named and coloured by the company (like Jira's statuses). Each
    is open or done (Jira's status categories): a card in a done column is a finished task, which
    is what the counts, the dashboard and "late" go by. At least one of each always remains.
    """

    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(16), server_default="gray")
    done: Mapped[bool] = mapped_column(server_default="false")
    position: Mapped[float] = mapped_column(Float, server_default="0")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name"),
        # lets tasks point at (id, tenant_id), so a task can't sit in another company's column
        UniqueConstraint("id", "tenant_id"),
        CheckConstraint(f"color IN {STAGE_COLORS}", name="color"),
    )


class Task(TenantMixin, Base):
    """Something someone has to do, optionally by a day (and time), about a customer or an order:
    "call Baraka about the debt on Friday". Not a legal document, so it's edited and deleted freely.
    """

    title: Mapped[str] = mapped_column(String(200))
    note: Mapped[str | None]
    due_date: Mapped[date | None] = mapped_column(Date)
    due_time: Mapped[time | None] = mapped_column(Time)
    customer_id: Mapped[int | None] = mapped_column(BigInteger)
    order_id: Mapped[int | None] = mapped_column(BigInteger)
    # who does it; the creator until staff accounts and a picker come
    assignee_id: Mapped[int | None] = mapped_column(BigInteger)
    created_by: Mapped[int | None] = mapped_column(BigInteger)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # the board's column; done_at is set while it's in a done column (TaskManager keeps them so)
    stage_id: Mapped[int] = mapped_column(BigInteger, index=True)
    priority: Mapped[str] = mapped_column(String(8), server_default="normal")
    # order within its column: a card dropped between two takes the halfway value, so one move
    # writes one row (fractional ranking)
    position: Mapped[float] = mapped_column(Float, server_default="0")

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        CheckConstraint(
            "due_time IS NULL OR due_date IS NOT NULL", name="time_needs_date"
        ),
        CheckConstraint(f"priority IN {PRIORITIES}", name="priority"),
        ForeignKeyConstraint(
            ["stage_id", "tenant_id"], ["task_stage.id", "task_stage.tenant_id"]
        ),
        ForeignKeyConstraint(
            ["customer_id", "tenant_id"],
            ["customer.id", "customer.tenant_id"],
        ),
        ForeignKeyConstraint(
            ["order_id", "tenant_id"],
            ["sales_order.id", "sales_order.tenant_id"],
        ),
        ForeignKeyConstraint(
            ["assignee_id", "tenant_id"],
            ["app_user.id", "app_user.tenant_id"],
            ondelete="SET NULL (assignee_id)",
        ),
        ForeignKeyConstraint(
            ["created_by", "tenant_id"],
            ["app_user.id", "app_user.tenant_id"],
            ondelete="SET NULL (created_by)",
        ),
        # open tasks by day: the list and the dock's count
        Index(
            "ix_task_open_due",
            "tenant_id",
            "due_date",
            postgresql_where="done_at IS NULL",
        ),
        Index("ix_task_tenant_customer", "tenant_id", "customer_id"),
    )
