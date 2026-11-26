import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.models import MONEY_PLACES, MOVE_KINDS
from app.schemas.common import InLang, Note, Paging
from app.schemas.payment import Positive
from app.schemas.product import Currency

Place = Literal[MONEY_PLACES]  # type: ignore[valid-type]


class MoveIn(BaseModel):
    kind: Literal[MOVE_KINDS]  # type: ignore[valid-type]
    place: Place
    currency: Currency
    amount: Positive
    # an expense or other money in: which kind (checked against the kind's list)
    category: str | None = None
    # a transfer: where to; the currency when it's an exchange, and then what arrived
    to_place: Place | None = None
    to_currency: Currency | None = None
    received: Positive | None = None
    date: dt.date | None = None  # today when left out
    note: Note = None


class MoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    date: dt.date
    kind: str
    place: str
    currency: str
    amount: Decimal
    category: str | None
    to_place: str | None
    to_currency: str | None
    received: Decimal | None
    exchange_rate: Decimal | None
    note: str | None
    created_at: dt.datetime
    cancelled_at: dt.datetime | None


class MoneyRow(BaseModel):
    """One line of the cash box or the bank. A transfer is two: out of one place, into the other."""

    source: str  # payment, supplier_payment or money_move: whose `id` this is
    id: int
    number: int
    date: dt.date
    kind: str  # payment, payout, expense, income, transfer
    place: str
    currency: str
    amount: Decimal  # signed: money in is positive
    category: str | None
    party: str | None  # the customer or the supplier
    party_id: int | None
    other_place: str | None  # a transfer's other end
    other_currency: str | None
    note: str | None
    cancelled_at: dt.datetime | None


class Balance(BaseModel):
    place: str
    currency: str
    amount: Decimal


class Flow(BaseModel):
    currency: str
    incoming: Decimal
    outgoing: Decimal


class MoneyPage(BaseModel):
    items: list[MoneyRow]
    total: int
    sums: list[Flow]  # of the lines found, cancelled ones left out
    balances: list[Balance]  # what's there now, whatever the filters


class MoneyFilters(BaseModel):
    place: Place | None = None
    currency: Currency | None = None
    kind: Literal["payment", "payout", "expense", "income", "transfer"] | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    sort: Literal["date", "-date"] = "-date"


class MoneyQuery(MoneyFilters, Paging):
    pass


class MoneyExport(MoneyFilters, InLang):
    pass


class ProfitQuery(BaseModel):
    date_from: dt.date
    date_to: dt.date

    @model_validator(mode="after")
    def _in_order(self):
        if self.date_from > self.date_to:
            raise ValueError("The period ends before it starts")
        return self


class Spent(BaseModel):
    category: str
    amount: Decimal


class UncostedProduct(BaseModel):
    id: int
    name: str
    sales: Decimal


class Uncosted(BaseModel):
    """Products sold in the period that were never received at a price: their cost counts as
    zero, so the profit is too high by what they really cost."""

    count: int
    sales: Decimal
    products: list[UncostedProduct]  # the biggest sellers, at most 10


class ProfitOut(BaseModel):
    currency: str  # the company's; everything is converted into it
    sales: Decimal  # confirmed orders less returns, VAT included
    cost: Decimal  # what the sold goods cost
    gross: Decimal
    expenses: list[Spent]  # the biggest first
    expenses_total: Decimal
    other_income: Decimal
    profit: Decimal
    uncosted: Uncosted
