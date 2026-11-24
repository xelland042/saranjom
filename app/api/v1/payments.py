import datetime as dt
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.core.xlsx import MAX_ROWS, METHOD, STATUS, word, xlsx
from app.crud.activity import ActivityLog
from app.crud.debts import DebtManager, today
from app.models import Customer
from app.schemas.payment import (
    Balance,
    DebtExport,
    DebtPage,
    DebtQuery,
    OpeningIn,
    PaymentIn,
    PaymentOut,
    PaymentExport,
    PaymentPage,
    PaymentQuery,
    Statement,
)
from app.schemas.product import Currency

router = APIRouter(tags=["Payments and debts"])


def _manager(session, current) -> DebtManager:
    user, tenant = current
    return DebtManager(session, tenant, user.id)


def _log(session, current, payment: dict, action: str) -> None:
    user, tenant = current
    ActivityLog(session, tenant.id, user.id).add(
        "payment",
        payment["id"],
        action,
        payment["customer_id"],
        number=payment["number"],
        amount=payment["amount"],
        currency=payment["currency"],
        method=payment["method"],
    )


async def _customer(session, customer_id: int) -> Customer:
    customer = await session.get(Customer, customer_id)
    if customer is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return customer


# ---------- payments ----------


@router.get("/payments", response_model=PaymentPage)
async def list_payments(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[PaymentQuery, Query()],
):
    items, total, sums = await _manager(session, current).payments(f, f.limit, f.offset)
    return PaymentPage(items=items, total=total, sums=sums)


@router.get("/payments/export")
async def export_payments(
    session: SessionDep, current: CurrentUser, f: Annotated[PaymentExport, Query()]
):
    items, _, _ = await _manager(session, current).payments(f, MAX_ROWS, 0)
    return xlsx(
        "payments",
        f.lang,
        [
            ("number", "int"),
            ("date", "date"),
            ("customer", "text"),
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
                p["customer_name"],
                p["amount"],
                p["currency"],
                word(METHOD, p["method"], f.lang),
                word(STATUS, "cancelled", f.lang) if p["cancelled_at"] else "",
                p["note"],
            ]
            for p in items
        ],
    )


@router.post("/payments", response_model=PaymentOut, status_code=201)
async def add_payment(data: PaymentIn, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    payment = await m.payment(await m.add_payment(data))
    _log(session, current, payment, "created")
    return payment


@router.get("/payments/{payment_id}", response_model=PaymentOut)
async def get_payment(payment_id: int, session: SessionDep, current: CurrentUser):
    payment = await _manager(session, current).payment(payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    return payment


@router.post("/payments/{payment_id}/cancel", response_model=PaymentOut)
async def cancel_payment(payment_id: int, session: SessionDep, current: CurrentUser):
    """Keeps it in the history and stops it counting; a wrong payment is entered again."""
    m = _manager(session, current)
    before = await m.payment(payment_id)
    if before is None or not await m.cancel_payment(payment_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    if before["cancelled_at"] is None:
        _log(session, current, before, "cancelled")
    return await m.payment(payment_id)


# ---------- debts ----------


@router.get("/debts", response_model=DebtPage)
async def list_debts(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[DebtQuery, Query()],
):
    """Customers whose balance isn't zero: positive owe the company, negative paid ahead."""
    items, total, totals = await _manager(session, current).page(f, f.limit, f.offset)
    return DebtPage(items=items, total=total, totals=totals)


@router.get("/debts/export")
async def export_debts(
    session: SessionDep, current: CurrentUser, f: Annotated[DebtExport, Query()]
):
    items, _, _ = await _manager(session, current).page(f, MAX_ROWS, 0)
    return xlsx(
        "debts",
        f.lang,
        [
            ("customer", "text"),
            ("balance", "money"),
            ("overdue", "money"),
            ("currency", "text"),
            ("late_since", "date"),
            ("last_payment", "date"),
        ],
        [
            [
                d["customer_name"],
                d["balance"],
                d["overdue"],
                d["currency"],
                d["late_since"],
                d["last_payment"],
            ]
            for d in items
        ],
    )


@router.get("/customers/{customer_id}/balances", response_model=list[Balance])
async def customer_balances(
    customer_id: int, session: SessionDep, current: CurrentUser
):
    customer = await _customer(session, customer_id)
    return await _manager(session, current).balances(customer)


@router.get("/customers/{customer_id}/statement", response_model=Statement)
async def customer_statement(
    customer_id: int,
    currency: Currency,
    session: SessionDep,
    current: CurrentUser,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    customer = await _customer(session, customer_id)
    return await _manager(session, current).statement(
        customer, currency, date_from, date_to or today()
    )


@router.put(
    "/customers/{customer_id}/opening-balances/{currency}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def set_opening_balance(
    customer_id: int,
    currency: Currency,
    data: OpeningIn,
    session: SessionDep,
    current: CurrentUser,
):
    customer = await _customer(session, customer_id)
    await _manager(session, current).set_opening(customer, currency, data)
    ActivityLog(session, current[1].id, current[0].id).add(
        "customer",
        customer.id,
        "opening_set",
        customer.id,
        amount=data.amount,
        currency=currency,
        date=data.date,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/customers/{customer_id}/opening-balances/{currency}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_opening_balance(
    customer_id: int, currency: Currency, session: SessionDep, current: CurrentUser
):
    customer = await _customer(session, customer_id)
    if not await _manager(session, current).delete_opening(customer, currency):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No opening balance")
    ActivityLog(session, current[1].id, current[0].id).add(
        "customer", customer.id, "opening_deleted", customer.id, currency=currency
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
