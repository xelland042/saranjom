import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.models import PAYMENT_METHODS
from app.schemas.common import InLang, Note, Paging
from app.schemas.product import Amount, Currency

Method = Literal[PAYMENT_METHODS]  # type: ignore[valid-type]
Positive = Annotated[Amount, Field(gt=0)]


def _not_zero(d: Decimal) -> Decimal:
    if d == 0:
        raise ValueError("Must not be zero")
    return d.quantize(Decimal("0.01"))


# what was owed (or, negative, paid ahead) when the company started with Saranjom
Signed = Annotated[
    Decimal, Field(max_digits=18, decimal_places=2), AfterValidator(_not_zero)
]


class PaymentIn(BaseModel):
    customer_id: int
    amount: Positive
    currency: Currency | None = None  # the customer's price list currency when left out
    method: Method = "cash"
    date: dt.date | None = None  # today when left out
    note: Note = None


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    date: dt.date
    customer_id: int
    customer_name: str
    amount: Decimal
    currency: str
    exchange_rate: Decimal | None
    method: str
    note: str | None
    created_at: dt.datetime
    cancelled_at: dt.datetime | None


class PaymentSum(BaseModel):
    currency: str
    amount: Decimal  # of the payments found, cancelled ones left out


class PaymentPage(BaseModel):
    items: list[PaymentOut]
    total: int
    sums: list[PaymentSum]


class PaymentFilters(BaseModel):
    q: Annotated[str, Field(max_length=200)] = ""
    customer_id: int | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    method: Method | None = None
    sort: Literal[
        "date", "-date", "number", "-number", "customer", "-customer", "amount", "-amount"
    ] = "-date"  # fmt: skip


class PaymentQuery(PaymentFilters, Paging):
    pass


class PaymentExport(PaymentFilters, InLang):
    pass


class DebtFilters(BaseModel):
    q: Annotated[str, Field(max_length=200)] = ""
    overdue: bool = False
    sort: Literal["balance", "late"] = "balance"


class DebtQuery(DebtFilters, Paging):
    pass


class DebtExport(DebtFilters, InLang):
    pass


class OpeningIn(BaseModel):
    amount: Signed
    date: dt.date


class Opening(BaseModel):
    amount: Decimal
    date: dt.date


class Debt(BaseModel):
    """A customer's balance in one currency: positive means they owe the company."""

    customer_id: int
    customer_name: str
    currency: str
    balance: Decimal
    overdue: Decimal  # the part of it past its due date
    late_since: dt.date | None  # due date of the oldest unpaid overdue sum
    last_payment: dt.date | None


class DebtTotal(BaseModel):
    currency: str
    owed: Decimal  # what customers owe, prepayments left out
    overdue: Decimal


class DebtPage(BaseModel):
    items: list[Debt]
    total: int
    totals: list[DebtTotal]


class Balance(Debt):
    opening: Opening | None


class StatementRow(BaseModel):
    date: dt.date
    kind: Literal["opening", "order", "payment", "return"]
    id: int
    number: int | None
    debit: Decimal  # adds to what they owe
    credit: Decimal  # lowers it
    balance: Decimal  # after this row


class Statement(BaseModel):
    """Акт сверки: everything with one customer in one currency over a period."""

    customer_id: int
    customer_name: str
    currency: str
    date_from: dt.date | None
    date_to: dt.date
    opening: Decimal
    rows: list[StatementRow]
    debit: Decimal
    credit: Decimal
    closing: Decimal


class CreditWarning(BaseModel):
    currency: str
    limit: Decimal
    debt: Decimal
