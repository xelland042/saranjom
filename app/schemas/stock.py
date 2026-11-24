import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.models import DOCUMENT_KINDS
from app.schemas.common import Name, Note, required
from app.schemas.product import Amount, Currency

Kind = Literal[DOCUMENT_KINDS]  # type: ignore[valid-type]
# positive, up to 3 decimals (kg, litres); returned as a string ("12.500")
Quantity = Annotated[
    Decimal,
    Field(gt=0, max_digits=18, decimal_places=3),
    AfterValidator(lambda d: d.quantize(Decimal("0.001"))),
]


class WarehouseIn(BaseModel):
    name: Name


class WarehousePatch(BaseModel):
    _name_required = field_validator("name")(required)
    name: Name | None = None
    is_default: Literal[True] | None = None
    archived: bool | None = None


class WarehouseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_default: bool
    archived: bool


class LineIn(BaseModel):
    product_id: int
    quantity: Quantity
    price: Amount | None = None  # receipts only


class DocumentIn(BaseModel):
    kind: Kind
    date: dt.date | None = None  # today when left out
    warehouse_id: int
    to_warehouse_id: int | None = None
    currency: Currency | None = None
    note: Note = None
    lines: list[LineIn] = Field(min_length=1, max_length=500)


class LineOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    unit: str
    quantity: Decimal
    price: Decimal | None


class Negative(BaseModel):
    """Stock that a document left below zero: allowed, but the user is told."""

    product_id: int
    product_name: str
    warehouse_id: int
    quantity: Decimal


class DocumentOut(BaseModel):
    id: int
    kind: str
    number: int
    date: dt.date
    warehouse_id: int
    to_warehouse_id: int | None
    currency: str | None
    note: str | None
    cancelled: bool
    created_at: dt.datetime
    lines: list[LineOut]
    negative: list[Negative] = []


class DocumentRow(BaseModel):
    id: int
    kind: str
    number: int
    date: dt.date
    warehouse_id: int
    to_warehouse_id: int | None
    cancelled: bool
    lines: int


class DocumentPage(BaseModel):
    items: list[DocumentRow]
    total: int


class StockRow(BaseModel):
    product_id: int
    name: str
    sku: str | None
    unit: str
    # warehouse id -> quantity; warehouses without movement are left out (zero)
    quantities: dict[int, Decimal]
    total: Decimal
    min_stock: Decimal | None


class StockPage(BaseModel):
    items: list[StockRow]
    total: int
