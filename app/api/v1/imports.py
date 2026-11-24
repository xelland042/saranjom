from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.core.xlsx import xlsx
from app.crud.imports import FIELDS, MAX_BYTES, Importer, read_sheet
from app.schemas.common import InLang
from app.schemas.imports import (
    CustomerImportIn,
    ImportResult,
    ProductImportIn,
    Sheet,
)

router = APIRouter(prefix="/import", tags=["Import"])


async def _read(request: Request, kind: str) -> Sheet:
    # the file is the body itself (no multipart), read up to the limit
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "The file is over 5 MB")
    return read_sheet(bytes(data), kind)


def _template(kind: str, lang: str):
    # headers only: the same words the import recognises
    return xlsx(
        f"{kind}-import",
        lang,
        [(header, "text") for header in FIELDS[kind].values()],
        [],
    )


@router.post("/customers/read", response_model=Sheet)
async def read_customers(request: Request, current: CurrentUser):
    return await _read(request, "customers")


@router.post("/products/read", response_model=Sheet)
async def read_products(request: Request, current: CurrentUser):
    return await _read(request, "products")


@router.get("/customers/template")
async def customers_template(current: CurrentUser, f: Annotated[InLang, Query()]):
    return _template("customers", f.lang)


@router.get("/products/template")
async def products_template(current: CurrentUser, f: Annotated[InLang, Query()]):
    return _template("products", f.lang)


def _need(current, permission: str) -> None:
    if not allowed(current, permission):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")


@router.post("/customers", response_model=ImportResult)
async def import_customers(
    data: CustomerImportIn, session: SessionDep, current: CurrentUser
):
    # opening debts are money
    if any(r.debt and r.debt.strip() for r in data.rows):
        _need(current, "money.write")
    user, tenant = current
    importer = Importer(session, tenant, user.id)
    return await importer.run(data, importer.customers)


@router.post("/products", response_model=ImportResult)
async def import_products(
    data: ProductImportIn, session: SessionDep, current: CurrentUser
):
    # the stock column makes stock documents
    if any(r.quantity and r.quantity.strip() for r in data.rows):
        _need(current, "stock.write")
    user, tenant = current
    importer = Importer(session, tenant, user.id)
    return await importer.run(data, importer.products)
