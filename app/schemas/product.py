import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
)

from app.models import UNITS
from app.schemas.common import (
    InLang,
    Name,
    Note,
    Paging,
    blank_to_none,
    required,
    text,
)

Unit = Literal[UNITS]  # type: ignore[valid-type]


def _mxik(v: str) -> str:
    digits = re.sub(r"\s", "", v)
    if not (digits.isdigit() and len(digits) == 17):
        raise ValueError("MXIK code is 17 digits")
    return digits


Code = Annotated[text(64) | None, BeforeValidator(blank_to_none)]
Mxik = Annotated[
    text(30) | None,
    BeforeValidator(blank_to_none),
    AfterValidator(lambda v: v and _mxik(v)),
]
Currency = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().upper() if isinstance(v, str) else v),
    Field(pattern=r"^[A-Z]{3}$"),
]
# a price: never negative, at most 2 decimals; sent and returned as a string ("12500.00")
Amount = Annotated[
    Decimal,
    Field(ge=0, max_digits=18, decimal_places=2),
    # same form as the database returns, so a fresh save and a later read look alike
    AfterValidator(lambda d: d.quantize(Decimal("0.01"))),
]


# a reorder point: 0 and up, like quantities at most 3 decimals
MinStock = Annotated[
    Decimal,
    Field(ge=0, max_digits=18, decimal_places=3),
    AfterValidator(lambda d: d.quantize(Decimal("0.001"))),
]


class PriceIn(BaseModel):
    price_list_id: int
    amount: Amount | None  # None removes this product's price in that list


class ProductIn(BaseModel):
    name: Name
    sku: Code = None
    barcode: Code = None
    unit: Unit = "pcs"
    category_id: int | None = None
    mxik: Mxik = None
    note: Note = None
    min_stock: MinStock | None = None
    cost: Amount | None = None  # per unit, in the company's currency
    prices: list[PriceIn] = []


class ProductPatch(BaseModel):
    # only the fields sent are changed; prices listed are set, others kept
    _name_required = field_validator("name", "unit")(required)
    name: Name | None = None
    sku: Code = None
    barcode: Code = None
    unit: Unit | None = None
    category_id: int | None = None
    mxik: Mxik = None
    note: Note = None
    min_stock: MinStock | None = None
    cost: Amount | None = None
    archived: bool | None = None
    prices: list[PriceIn] = []


class PriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    price_list_id: int
    amount: Decimal


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    sku: str | None
    barcode: str | None
    unit: str
    category_id: int | None
    mxik: str | None
    note: str | None
    min_stock: Decimal | None
    cost: Decimal | None
    archived: bool
    updated_at: datetime
    prices: list[PriceOut]


class ProductRow(ProductOut):
    stock: Decimal  # in all warehouses together
    low: bool  # below its minimum stock


class ProductPage(BaseModel):
    items: list[ProductRow]
    total: int


class ProductFilters(BaseModel):
    q: Annotated[str, Field(max_length=200)] = ""
    category_id: int | None = None
    archived: bool = False
    sort: Literal["name", "-name", "sku", "-sku", "stock", "-stock"] = "name"


class ProductQuery(ProductFilters, Paging):
    pass


class ProductExport(ProductFilters, InLang):
    pass


class Movement(BaseModel):
    """One posted change of a product's stock: a receipt, write-off, transfer or sale."""

    date: date
    kind: Literal["receipt", "write_off", "transfer", "sale", "return"]
    id: int  # the stock document's, the order's or the return's
    number: int
    warehouse_id: int
    to_warehouse_id: int | None
    quantity: Decimal
    customer_name: str | None


class CategoryIn(BaseModel):
    name: Name


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    products: int = 0


class PriceListIn(BaseModel):
    name: Name
    currency: Currency


class PriceListPatch(BaseModel):
    # the currency can't change: the prices already in the list are in it
    _name_required = field_validator("name")(required)
    name: Name | None = None
    is_default: Literal[True] | None = (
        None  # make this the default; the old one stops being it
    )
    archived: bool | None = None


class PriceListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    currency: str
    is_default: bool
    archived: bool


class RateOut(BaseModel):
    currency: str
    # units of the company's main currency for one unit; None when no rate is known yet
    rate: Decimal | None
    source: Literal["company", "cbu"] | None
    cbu_rate: Decimal | None
    cbu_date: date | None


class RatesOut(BaseModel):
    base: str
    rates: list[RateOut]


class RateIn(BaseModel):
    rate: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=6)]
