from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from .common import InLang
from .money import ProfitQuery


class SalesReportQuery(ProfitQuery):
    by: Literal["product", "customer", "manager"] = "product"
    sort: Literal[
        "name",
        "-name",
        "orders",
        "-orders",
        "quantity",
        "-quantity",
        "sales",
        "-sales",
        "profit",
        "-profit",
    ] = "-sales"


class SalesReportExport(SalesReportQuery, InLang):
    pass


class SalesRow(BaseModel):
    id: int | None  # none: orders entered by someone since removed
    name: str | None
    unit: str | None  # by product only
    orders: int
    quantity: Decimal
    sales: Decimal
    # the three below only for those who see money
    cost: Decimal | None
    profit: Decimal | None
    # the part of `sales` whose cost isn't known (counted as zero)
    uncosted: Decimal | None


class SalesReportOut(BaseModel):
    currency: str  # the company's; everything is converted into it
    items: list[SalesRow]
    sales: Decimal
    cost: Decimal | None
    profit: Decimal | None
