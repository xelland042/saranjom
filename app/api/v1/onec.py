import datetime as dt
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, model_validator

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.crud.onec import OneCExport
from app.schemas.customer import Inn

router = APIRouter(tags=["1C"])


class ExportQuery(BaseModel):
    date_from: dt.date
    date_to: dt.date
    # 1.4 by default: the newest a real Uzbek copy (3.0) reads; newer copies read it too
    version: Literal["1.4", "1.5", "1.8"] = "1.4"

    @model_validator(mode="after")
    def _order(self):
        if self.date_from > self.date_to:
            raise ValueError("date_from is after date_to")
        return self


class CompanyPatch(BaseModel):
    inn: Inn = None
    # an Uzbek settlement account: 20 digits
    bank_account: Annotated[str | None, Field(pattern=r"^\d{20}$")] = None
    # exactly as in 1C (Главное → Организации), which finds the organisation by name
    onec_name: Annotated[str | None, Field(min_length=1, max_length=200)] = None


@router.get("/onec/export")
async def export_1c(
    session: SessionDep, current: CurrentUser, q: Annotated[ExportQuery, Query()]
):
    """Sales and payments of a period as an EnterpriseData file for 1C:Бухгалтерия."""
    if not allowed(current, "orders.read"):  # it holds sales as well as money
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")
    content = await OneCExport(session, current[1], q.version).build(
        q.date_from, q.date_to
    )
    name = f"1c-{q.date_from}-{q.date_to}.xml"
    return Response(
        content,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )


@router.patch("/company")
async def update_company(data: CompanyPatch, session: SessionDep, current: CurrentUser):
    tenant = current[1]
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)
    await session.flush()
    return {
        "inn": tenant.inn,
        "bank_account": tenant.bank_account,
        "onec_name": tenant.onec_name,
    }
