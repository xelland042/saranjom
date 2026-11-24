import re
from decimal import Decimal
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    Field,
    model_validator,
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    field_validator,
)

from app.core.security import normalize_phone
from app.schemas.product import Amount, Currency
from app.schemas.common import (
    InLang,
    Name,
    Note,
    Paging,
    Text,
    blank_to_none,
    required,
    text,
)


def _inn(v: str) -> str:
    digits = re.sub(r"\s", "", v)
    if not (digits.isdigit() and len(digits) in (9, 14)):
        raise ValueError("INN must be 9 digits (ПИНФЛ: 14)")
    return digits


Phone = Annotated[
    text(30) | None,
    BeforeValidator(blank_to_none),
    AfterValidator(lambda v: v and normalize_phone(v)),
]
PaymentDays = Annotated[int, Field(ge=0, le=365)]


def _limit_with_currency(m):
    # sent together by the form; one without the other is a mistake
    if ("credit_limit" in m.model_fields_set) != (
        "credit_currency" in m.model_fields_set
    ) or (m.credit_limit is None) != (m.credit_currency is None):
        raise ValueError("credit_limit and credit_currency go together")
    return m


Inn = Annotated[
    text(30) | None,
    BeforeValidator(blank_to_none),
    AfterValidator(lambda v: v and _inn(v)),
]


class CustomerIn(BaseModel):
    name: Name
    inn: Inn = None
    phone: Phone = None
    address: Text = None
    note: Note = None
    price_list_id: int | None = None
    payment_days: PaymentDays | None = None
    credit_limit: Amount | None = None
    credit_currency: Currency | None = None

    _together = model_validator(mode="after")(_limit_with_currency)


class CustomerPatch(BaseModel):
    _name_required = field_validator("name")(required)
    # only the fields sent are changed (model_fields_set)
    name: Name | None = None
    inn: Inn = None
    phone: Phone = None
    address: Text = None
    note: Note = None
    price_list_id: int | None = None
    payment_days: PaymentDays | None = None
    credit_limit: Amount | None = None
    credit_currency: Currency | None = None
    archived: bool | None = None

    _together = model_validator(mode="after")(_limit_with_currency)


class ContactIn(BaseModel):
    name: Name
    phone: Phone = None
    position: Text = None


class ContactPatch(BaseModel):
    _name_required = field_validator("name")(required)
    name: Name | None = None
    phone: Phone = None
    position: Text = None


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    phone: str | None
    position: str | None


class CustomerRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    inn: str | None
    phone: str | None
    address: str | None
    archived: bool
    price_list_id: int | None
    payment_days: int | None
    credit_limit: Decimal | None
    credit_currency: str | None


class BalanceShort(BaseModel):
    currency: str
    balance: Decimal
    overdue: Decimal


class CustomerListRow(CustomerRow):
    last_order: date | None  # of their confirmed orders
    balances: list[BalanceShort]  # what they owe per currency, zero ones left out


class CustomerOut(CustomerRow):
    note: str | None
    created_at: datetime
    updated_at: datetime
    contacts: list[ContactOut]


class CustomerPage(BaseModel):
    items: list[CustomerListRow]
    total: int


class CustomerFilters(BaseModel):
    q: Annotated[str, Field(max_length=200)] = ""
    archived: bool = False
    sort: Literal[
        "name", "-name", "created", "-created", "last_order", "-last_order"
    ] = "name"  # fmt: skip


class CustomerQuery(CustomerFilters, Paging):
    pass


class CustomerExport(CustomerFilters, InLang):
    pass
