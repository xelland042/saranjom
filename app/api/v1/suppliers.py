from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.core.xlsx import MAX_ROWS, METHOD, STATUS, word, xlsx
from app.crud.activity import ActivityLog, changes, snapshot
from app.crud.suppliers import SupplierManager
from app.models import Supplier
from app.schemas.supplier import (
    SupplierIn,
    SupplierOut,
    SupplierPage,
    SupplierPatch,
    SupplierPaymentExport,
    SupplierPaymentIn,
    SupplierPaymentOut,
    SupplierPaymentPage,
    SupplierPaymentQuery,
    SupplierQuery,
)

router = APIRouter(tags=["Suppliers"])


def _manager(session, current) -> SupplierManager:
    user, tenant = current
    return SupplierManager(session, tenant, user.id)


def _log(session, current) -> ActivityLog:
    user, tenant = current
    return ActivityLog(session, tenant.id, user.id)


def _log_payment(session, current, payment: dict, action: str) -> None:
    _log(session, current).add(
        "supplier_payment",
        payment["id"],
        action,
        supplier_id=payment["supplier_id"],
        number=payment["number"],
        amount=payment["amount"],
        currency=payment["currency"],
        method=payment["method"],
    )


async def _supplier(m: SupplierManager, supplier_id: int) -> Supplier:
    supplier = await m.get(supplier_id)
    if supplier is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier not found")
    return supplier


async def _out(m: SupplierManager, current, suppliers: list[Supplier]) -> list[dict]:
    # what we owe is money: only for those who may see it
    owed = (
        await m.balances_of([s.id for s in suppliers])
        if allowed(current, "money.read")
        else {}
    )
    return [
        {**SupplierOut.model_validate(s).model_dump(), "balances": owed.get(s.id, [])}
        for s in suppliers
    ]


@router.get("/suppliers", response_model=SupplierPage)
async def list_suppliers(
    session: SessionDep, current: CurrentUser, f: Annotated[SupplierQuery, Query()]
):
    m = _manager(session, current)
    money = allowed(current, "money.read")
    if f.owed and not money:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    suppliers, total = await m.page(f, f.limit, f.offset)
    return SupplierPage(
        items=await _out(m, current, suppliers),
        total=total,
        owed=await m.totals() if money else [],
    )


@router.post(
    "/suppliers", response_model=SupplierOut, status_code=status.HTTP_201_CREATED
)
async def create_supplier(data: SupplierIn, session: SessionDep, current: CurrentUser):
    supplier = await _manager(session, current).create(data)
    _log(session, current).add("supplier", supplier.id, "created")
    return supplier


@router.get("/suppliers/{supplier_id}", response_model=SupplierOut)
async def get_supplier(supplier_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    return (await _out(m, current, [await _supplier(m, supplier_id)]))[0]


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
async def update_supplier(
    supplier_id: int, data: SupplierPatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    supplier = await _supplier(m, supplier_id)
    fields = data.model_dump(exclude_unset=True)
    was_archived = supplier.archived
    before = snapshot(supplier, [f for f in fields if f != "archived"])
    await m.update(supplier, data)
    log = _log(session, current)
    if diff := changes(before, supplier):
        log.add("supplier", supplier.id, "updated", changes=diff)
    if supplier.archived != was_archived:
        log.add(
            "supplier", supplier.id, "archived" if supplier.archived else "restored"
        )
    return (await _out(m, current, [supplier]))[0]


# ---------- paying them ----------


@router.get("/supplier-payments", response_model=SupplierPaymentPage)
async def list_payments(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[SupplierPaymentQuery, Query()],
):
    items, total, sums = await _manager(session, current).payments(f, f.limit, f.offset)
    return SupplierPaymentPage(items=items, total=total, sums=sums)


@router.get("/supplier-payments/export")
async def export_payments(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[SupplierPaymentExport, Query()],
):
    items, _, _ = await _manager(session, current).payments(f, MAX_ROWS, 0)
    return xlsx(
        "supplier-payments",
        f.lang,
        [
            ("number", "int"),
            ("date", "date"),
            ("supplier", "text"),
            ("amount", "money"),
            ("currency", "text"),
            ("method", "text"),
            ("status", "text"),
            ("note", "text"),
        ],
        [
            [
                p["number"],
                p["date"],
                p["supplier_name"],
                p["amount"],
                p["currency"],
                word(METHOD, p["method"], f.lang),
                word(STATUS, "cancelled", f.lang) if p["cancelled_at"] else "",
                p["note"],
            ]
            for p in items
        ],
    )


@router.post("/supplier-payments", response_model=SupplierPaymentOut, status_code=201)
async def add_payment(
    data: SupplierPaymentIn, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    payment = await m.payment(await m.add_payment(data))
    _log_payment(session, current, payment, "created")
    return payment


@router.get("/supplier-payments/{payment_id}", response_model=SupplierPaymentOut)
async def get_payment(payment_id: int, session: SessionDep, current: CurrentUser):
    payment = await _manager(session, current).payment(payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    return payment


@router.post(
    "/supplier-payments/{payment_id}/cancel", response_model=SupplierPaymentOut
)
async def cancel_payment(payment_id: int, session: SessionDep, current: CurrentUser):
    """Keeps it in the history and stops it counting; a wrong payment is entered again."""
    m = _manager(session, current)
    before = await m.payment(payment_id)
    if before is None or not await m.cancel_payment(payment_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if before["cancelled_at"] is None:
        _log_payment(session, current, before, "cancelled")
    return await m.payment(payment_id)
