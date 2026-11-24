import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.models import ORDER_STATUSES
from app.schemas.common import InLang, Note, Paging
from app.schemas.payment import CreditWarning
from app.schemas.product import Amount
from app.schemas.stock import Negative, Quantity

Status = Literal[ORDER_STATUSES]  # type: ignore[valid-type]
Percent = Annotated[
    Decimal,
    Field(ge=0, le=100, max_digits=5, decimal_places=2),
    AfterValidator(lambda d: d.quantize(Decimal("0.01"))),
]


class VatRateIn(BaseModel):
    rate: Annotated[Percent, Field(lt=100)]
    valid_from: dt.date


class VatRateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rate: Decimal
    valid_from: dt.date


class OrderLineIn(BaseModel):
    product_id: int
    quantity: Quantity
    price: Amount  # per unit, VAT included
    discount: Percent = Decimal("0.00")


class OrderIn(BaseModel):
    """A draft order, sent whole every time it's saved."""

    customer_id: int
    date: dt.date | None = None  # today when left out
    warehouse_id: int | None = None  # the default warehouse when left out
    # the customer's own list, else the company's default, when left out
    price_list_id: int | None = None
    note: Note = None
    lines: list[OrderLineIn] = Field(default=[], max_length=500)


class OrderLineOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    unit: str
    quantity: Decimal
    price: Decimal
    discount: Decimal
    amount: Decimal
    vat_rate: Decimal
    vat_amount: Decimal
    returned: Decimal = Decimal("0.000")  # brought back by returns that still count


class ReturnRow(BaseModel):
    """A return as listed on its order's page."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    number: int
    date: dt.date
    total: Decimal
    cancelled: bool


class OrderOut(BaseModel):
    id: int
    number: int
    date: dt.date
    status: str
    customer_id: int
    customer_name: str
    warehouse_id: int
    price_list_id: int
    currency: str
    exchange_rate: Decimal | None
    total: Decimal
    vat_total: Decimal
    note: str | None
    created_at: dt.datetime
    confirmed_at: dt.datetime | None
    due_date: dt.date | None
    unpaid: Decimal | None = None  # what's left to pay, confirmed orders only
    lines: list[OrderLineOut]
    returns: list[ReturnRow] = []
    returned_total: Decimal = Decimal("0.00")  # of the returns that still count
    negative: list[Negative] = []
    credit: CreditWarning | None = None  # confirming took the debt above the limit


class ReturnLineIn(BaseModel):
    order_line_id: int
    quantity: Quantity


class ReturnIn(BaseModel):
    """Goods coming back from a confirmed order: which of its lines and how much of each."""

    date: dt.date | None = None  # today when left out
    warehouse_id: int | None = None  # the order's when left out
    note: Note = None
    lines: list[ReturnLineIn] = Field(min_length=1, max_length=500)


class ReturnLineOut(BaseModel):
    id: int
    order_line_id: int
    product_id: int
    product_name: str
    unit: str
    quantity: Decimal
    price: Decimal  # the order line's, VAT included
    discount: Decimal
    amount: Decimal
    vat_rate: Decimal
    vat_amount: Decimal


class ReturnOut(BaseModel):
    id: int
    number: int
    date: dt.date
    order_id: int
    order_number: int
    customer_id: int
    customer_name: str
    warehouse_id: int
    currency: str
    exchange_rate: Decimal | None
    total: Decimal
    vat_total: Decimal
    note: str | None
    created_at: dt.datetime
    cancelled: bool
    lines: list[ReturnLineOut]
    negative: list[Negative] = (
        []
    )  # cancelling took stock below zero (allowed, reported)


class OrderRow(BaseModel):
    id: int
    number: int
    date: dt.date
    status: str
    customer_id: int
    customer_name: str
    currency: str
    total: Decimal
    lines: int
    due_date: dt.date | None
    unpaid: Decimal | None  # confirmed orders only
    returned_total: Decimal = Decimal("0.00")  # of its returns that still count


class OrderSum(BaseModel):
    currency: str
    total: Decimal  # of the confirmed orders among those found
    unpaid: Decimal


class OrderPage(BaseModel):
    items: list[OrderRow]
    total: int
    sums: list[OrderSum]


Sort = Literal[
    "date", "-date", "number", "-number", "customer", "-customer",
    "total", "-total", "due", "-due",
]  # fmt: skip


class OrderFilters(BaseModel):
    """The list's filters, shared by the page and its Excel file."""

    q: Annotated[str, Field(max_length=200)] = ""
    status: Status | None = None
    customer_id: int | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    # confirmed orders not fully paid; "overdue": and past their due date
    payment: Literal["unpaid", "overdue"] | None = None
    sort: Sort = "-date"


class OrderQuery(OrderFilters, Paging):
    pass


class OrderExport(OrderFilters, InLang):
    pass
