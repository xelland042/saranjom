from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.core.xlsx import xlsx
from app.crud.reports import SalesReport
from app.schemas.reports import SalesReportExport, SalesReportOut, SalesReportQuery

router = APIRouter(tags=["Reports"])


async def _sales(session, current, f: SalesReportQuery) -> dict:
    # what the goods cost and what was earned on them is money: sales alone for the rest
    return await SalesReport(session, current[1]).build(
        f.by, f.date_from, f.date_to, f.sort, allowed(current, "money.read")
    )


@router.get("/reports/sales", response_model=SalesReportOut)
async def sales_report(
    session: SessionDep, current: CurrentUser, f: Annotated[SalesReportQuery, Query()]
):
    return await _sales(session, current, f)


@router.get("/reports/sales/export")
async def export_sales_report(
    session: SessionDep, current: CurrentUser, f: Annotated[SalesReportExport, Query()]
):
    report = await _sales(session, current, f)
    money = report["cost"] is not None
    columns = [(f.by, "text")]
    columns += (
        [("unit", "text"), ("quantity", "qty")]
        if f.by == "product"
        else [("orders", "int")]
    )
    columns += [("sales", "money")]
    columns += [("cost", "money"), ("profit", "money")] if money else []
    return xlsx(
        "sales",
        f.lang,
        columns,
        [
            [r["name"] or "—"]
            + ([r["unit"], r["quantity"]] if f.by == "product" else [r["orders"]])
            + [r["sales"]]
            + ([r["cost"], r["profit"]] if money else [])
            for r in report["items"]
        ],
    )
