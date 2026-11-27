from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.core.xlsx import MAX_ROWS, xlsx
from app.crud.activity import ActivityLog
from app.crud.stock import StockManager
from app.crud.suppliers import SupplierManager
from app.models import StockDocument, Supplier, Warehouse
from app.schemas.stock import (
    CountIn,
    CountOut,
    DocumentIn,
    DocumentOut,
    DocumentPage,
    Kind,
    StockPage,
    WarehouseIn,
    WarehouseOut,
    WarehousePatch,
)

router = APIRouter(tags=["Stock"])


def _manager(session, current) -> StockManager:
    user, tenant = current
    return StockManager(session, tenant.id, user.id)


def _found[T](row: T | None, what: str) -> T:
    if row is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return row


def _log(session, current, doc: StockDocument, action: str) -> None:
    user, tenant = current
    ActivityLog(session, tenant.id, user.id).add(
        "stock_document", doc.id, action, kind=doc.kind, number=doc.number
    )


async def _out(m: StockManager, doc: StockDocument, with_negative: bool) -> DocumentOut:
    products = await m.products_of(doc)
    supplier = doc.supplier_id and await m.session.get(Supplier, doc.supplier_id)
    return DocumentOut(
        id=doc.id,
        kind=doc.kind,
        number=doc.number,
        date=doc.date,
        warehouse_id=doc.warehouse_id,
        to_warehouse_id=doc.to_warehouse_id,
        currency=doc.currency,
        supplier_id=doc.supplier_id,
        supplier_name=supplier.name if supplier else None,
        total=doc.total,
        exchange_rate=doc.exchange_rate,
        note=doc.note,
        cancelled=doc.cancelled,
        created_at=doc.created_at,
        lines=[
            {
                "id": line.id,
                "product_id": line.product_id,
                "product_name": products[line.product_id].name,
                "unit": products[line.product_id].unit,
                "quantity": line.quantity,
                "price": line.price,
            }
            for line in doc.lines
        ],
        negative=await m.negatives(doc) if with_negative else [],
    )


# ---------- warehouses ----------


@router.get("/warehouses", response_model=list[WarehouseOut])
async def list_warehouses(session: SessionDep, current: CurrentUser):
    return await _manager(session, current).warehouses()


@router.post(
    "/warehouses", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED
)
async def create_warehouse(
    data: WarehouseIn, session: SessionDep, current: CurrentUser
):
    return await _manager(session, current).create_warehouse(data)


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseOut)
async def update_warehouse(
    warehouse_id: int, data: WarehousePatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    w: Warehouse = _found(await m.get_warehouse(warehouse_id), "Warehouse")
    return await m.update_warehouse(w, data)


# ---------- balances ----------


@router.get("/stock", response_model=StockPage)
async def stock(
    session: SessionDep,
    current: CurrentUser,
    q: Annotated[str, Query(max_length=200)] = "",
    warehouse_id: int | None = None,
    show: Literal["all", "positive", "negative", "low"] = "all",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    items, total = await _manager(session, current).stock_page(
        q, warehouse_id, show, limit, offset
    )
    return StockPage(items=items, total=total)


@router.get("/stock/export")
async def export_stock(
    session: SessionDep,
    current: CurrentUser,
    q: Annotated[str, Query(max_length=200)] = "",
    warehouse_id: int | None = None,
    show: Literal["all", "positive", "negative", "low"] = "all",
    lang: Literal["uz", "uz-Cyrl", "ru"] = "uz",
):
    """Balances as filtered: a column per warehouse and the total."""
    m = _manager(session, current)
    items, _ = await m.stock_page(q, warehouse_id, show, MAX_ROWS, 0)
    places = [
        w
        for w in await m.warehouses()
        if warehouse_id in (None, w.id) and not w.archived
    ]
    return xlsx(
        "stock",
        lang,
        [
            ("product", "text"),
            ("sku", "text"),
            ("unit", "text"),
            *[("stock", "qty", w.name) for w in places],
            ("stock", "qty"),
            ("min_stock", "qty"),
        ],
        [
            [
                i["name"],
                i["sku"],
                i["unit"],
                *[i["quantities"].get(w.id, 0) for w in places],
                i["total"],
                i["min_stock"],
            ]
            for i in items
        ],
    )


@router.get("/stock/balances", response_model=dict[int, dict[int, str]])
async def balances(
    session: SessionDep,
    current: CurrentUser,
    product_id: Annotated[list[int], Query(max_length=500)],
):
    """For a document being filled in: what each product has in each warehouse now."""
    per = await _manager(session, current).balances(product_id)
    return {p: {w: str(q) for w, q in ws.items()} for p, ws in per.items()}


# ---------- documents ----------


@router.get("/stock-documents", response_model=DocumentPage)
async def list_documents(
    session: SessionDep,
    current: CurrentUser,
    kind: Kind | None = None,
    supplier_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    items, total = await _manager(session, current).documents(
        kind, limit, offset, supplier_id
    )
    return DocumentPage(items=items, total=total)


@router.post(
    "/stock-documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED
)
async def create_document(data: DocumentIn, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    # a purchase in a foreign currency saves its rate, like an order
    rate = (
        await SupplierManager(session, current[1]).rate(data.currency)
        if data.supplier_id is not None and data.currency
        else None
    )
    doc = await m.create_document(data, rate)
    _log(session, current, doc, "created")
    return await _out(m, doc, with_negative=True)


@router.get("/stock-documents/{document_id}", response_model=DocumentOut)
async def get_document(document_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    doc = _found(await m.get_document(document_id), "Document")
    return await _out(m, doc, with_negative=False)


@router.post("/stock-documents/{document_id}/cancel", response_model=DocumentOut)
async def cancel_document(document_id: int, session: SessionDep, current: CurrentUser):
    """Cancelling a receipt can leave stock below zero; like a sale, that's allowed and reported."""
    m = _manager(session, current)
    doc = _found(await m.get_document(document_id), "Document")
    was_cancelled = doc.cancelled_at is not None
    doc = await m.cancel_document(doc)
    if not was_cancelled:
        _log(session, current, doc, "cancelled")
    return await _out(m, doc, with_negative=True)


@router.post("/stock-counts", response_model=CountOut, status_code=201)
async def count_stock(data: CountIn, session: SessionDep, current: CurrentUser):
    """Brings a warehouse to what was counted: a receipt for what was found over and a
    write-off for what is missing, so each can be read and cancelled like any document.
    409 with the products whose stock moved since the person saw it (a sale confirmed
    meanwhile): they look at the new numbers and send again."""
    m = _manager(session, current)
    await m.check_warehouse("warehouse_id", data.warehouse_id)
    moved = await m.moved_since(
        data.warehouse_id, {line.product_id: line.expected for line in data.lines}
    )
    if moved:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"moved": {str(pid): str(q) for pid, q in moved.items()}},
        )
    docs = await m.set_stock(
        data.warehouse_id,
        {line.product_id: line.counted for line in data.lines},
        note=data.note,
    )
    for doc in docs:
        _log(session, current, doc, "created")
    return CountOut(documents=docs)
