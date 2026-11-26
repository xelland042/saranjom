from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TenantMixin

# where money is. A payment's method says which: cash is the cash box, the rest reach the bank.
# shortcut: one cash box and one bank account per currency; named accounts (and a field for
# them on every payment) when a firm with several asks.
MONEY_PLACES = ("cash", "bank")
MOVE_KINDS = ("expense", "income", "transfer")
# shortcut: a fixed list, with "other" and a note for the rest; a company's own list when asked
EXPENSES = (
    "rent",
    "salary",
    "transport",
    "utilities",
    "taxes",
    "bank_fee",
    "marketing",
    "other",
    "owner_out",
)
INCOMES = ("opening", "owner_in", "other")
# money that moved without being earned or spent: left out of profit
OUTSIDE_PROFIT = ("opening", "owner_in", "owner_out")


class MoneyMove(TenantMixin, Base):
    """Money in or out that is neither a customer's payment nor a payment to a supplier: an
    expense, other money in (the amount the company started with, the owner's own money), or a
    transfer between the cash box and the bank, which is also how currency is exchanged (out of
    one currency, `received` in the other). Never edited: a wrong one is cancelled and entered
    again."""

    number: Mapped[int] = mapped_column(Integer)
    date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))
    place: Mapped[str] = mapped_column(String(8))
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    category: Mapped[str | None] = mapped_column(String(16))
    # a transfer only: where it went and what arrived there
    to_place: Mapped[str | None] = mapped_column(String(8))
    to_currency: Mapped[str | None] = mapped_column(String(3))
    received: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    # units of the company's main currency per one unit, saved when entered (not on transfers)
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    note: Mapped[str | None]
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="SET NULL")
    )

    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint("tenant_id", "number"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(f"kind IN {MOVE_KINDS}", name="kind"),
        CheckConstraint(f"place IN {MONEY_PLACES}", name="place"),
        CheckConstraint(
            "CASE WHEN kind = 'transfer' THEN category IS NULL AND received > 0"
            f" AND to_place IN {MONEY_PLACES} AND to_currency IS NOT NULL"
            " AND (to_place <> place OR to_currency <> currency)"
            " ELSE category IS NOT NULL AND to_place IS NULL AND to_currency IS NULL"
            " AND received IS NULL END",
            name="shape",
        ),
        Index("ix_money_move_tenant_date", "tenant_id", "date"),
    )
