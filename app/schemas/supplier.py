import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import InLang, Name, Note, Paging, Text, required
from app.schemas.customer import Inn, Phone
from app.schemas.payment import Method, Positive
from app.schemas.product import Currency


class SupplierIn(BaseModel):
    name: Name
    inn: Inn = None
    phone: Phone = None
    address: Text = None
    note: Note = None


class SupplierPatch(BaseModel):
    _name_required = field_validator("name")(required)
    # only the fields sent are changed (model_fields_set)
    name: Name | None = None
    inn: Inn = None
    phone: Phone = None
    address: Text = None
    note: Note = None
    archived: bool | None = None


class Owed(BaseModel):
    currency: str
    owed: Decimal  # what we owe; negative when we paid ahead


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    inn: str | None
    phone: str | None
    address: str | None
    note: str | None
    archived: bool
    created_at: dt.datetime
    # per currency, zero ones left out; empty for those who may not see money
    balances: list[Owed] = []


class SupplierPage(BaseModel):
    items: list[SupplierOut]
    total: int
    owed: list[Owed]  # to all suppliers together, whatever the filters


class SupplierFilters(BaseModel):
    q: Annotated[str, Field(max_length=200)] = ""
    archived: bool = False
    owed: bool = False  # only those we owe something
    sort: Literal["name", "-name", "created", "-created"] = "name"


class SupplierQuery(SupplierFilters, Paging):
    pass


class SupplierPaymentIn(BaseModel):
    supplier_id: int
    amount: Positive
    currency: Currency
    method: Method = "cash"
    date: dt.date | None = None  # today when left out
    note: Note = None


class SupplierPaymentOut(BaseModel):
    id: int
    number: int
    date: dt.date
    supplier_id: int
    supplier_name: str
    amount: Decimal
    currency: str
    exchange_rate: Decimal | None
    method: str
    note: str | None
    created_at: dt.datetime
    cancelled_at: dt.datetime | None


class PaidSum(BaseModel):
    currency: str
    amount: Decimal  # of the payments found, cancelled ones left out


class SupplierPaymentPage(BaseModel):
    items: list[SupplierPaymentOut]
    total: int
    sums: list[PaidSum]


class SupplierPaymentFilters(BaseModel):
    q: Annotated[str, Field(max_length=200)] = ""
    supplier_id: int | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    sort: Literal["date", "-date", "number", "-number", "amount", "-amount"] = "-date"


class SupplierPaymentQuery(SupplierPaymentFilters, Paging):
    pass


class SupplierPaymentExport(SupplierPaymentFilters, InLang):
    pass
