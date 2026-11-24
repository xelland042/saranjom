from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.core.xlsx import MAX_ROWS, STATUS, word, xlsx
from app.crud.activity import ActivityLog
from app.crud.debts import DebtManager
from app.crud.orders import OrderManager
from app.crud.returns import ZERO, ReturnManager
from app.models import SalesOrder, VatRate
from app.schemas.payment import CreditWarning
from app.schemas.order import (
    OrderExport,
    OrderIn,
    OrderOut,
    OrderPage,
    OrderQuery,
    VatRateIn,
    VatRateOut,
)

router = APIRouter(tags=["Orders"])
ZERO_QTY = Decimal("0.000")


def _manager(session, current) -> OrderManager:
    user, tenant = current
    return OrderManager(session, tenant, user.id)


async def _order(m: OrderManager, order_id: int) -> SalesOrder:
    order = await m.get(order_id)
    if order is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


def _log(session, current, order: SalesOrder, action: str) -> None:
    user, tenant = current
    ActivityLog(session, tenant.id, user.id).add(
        "order",
        order.id,
        action,
        order.customer_id,
        number=order.number,
        total=order.total,
        currency=order.currency,
    )


async def _out(m: OrderManager, order: SalesOrder, negative=()) -> OrderOut:
    customer, products = await m.names(order)
    returns = ReturnManager(m.session, m.tenant)
    back = await returns.returned(order.id) if order.status == "confirmed" else {}
    listed = await returns.of_order(order.id)
    return OrderOut(
        id=order.id,
        number=order.number,
        date=order.date,
        status=order.status,
        customer_id=order.customer_id,
        customer_name=customer,
        warehouse_id=order.warehouse_id,
        price_list_id=order.price_list_id,
        currency=order.currency,
        exchange_rate=order.exchange_rate,
        total=order.total,
        vat_total=order.vat_total,
        note=order.note,
        created_at=order.created_at,
        confirmed_at=order.confirmed_at,
        due_date=order.due_date,
        unpaid=await m.unpaid(order),
        lines=[
            {
                "id": line.id,
                "product_id": line.product_id,
                "product_name": products[line.product_id].name,
                "unit": products[line.product_id].unit,
                "quantity": line.quantity,
                "price": line.price,
                "discount": line.discount,
                "amount": line.amount,
                "vat_rate": line.vat_rate,
                "vat_amount": line.vat_amount,
                "returned": back[line.id][0] if line.id in back else ZERO_QTY,
            }
            for line in order.lines
        ],
        returns=listed,
        returned_total=sum((r.total for r in listed if not r.cancelled), ZERO),
        negative=list(negative),
    )


# ---------- VAT ----------


@router.get("/vat-rates", response_model=list[VatRateOut])
async def list_vat_rates(session: SessionDep, current: CurrentUser):
    return await _manager(session, current).vat_rates()


@router.post(
    "/vat-rates", response_model=VatRateOut, status_code=status.HTTP_201_CREATED
)
async def add_vat_rate(data: VatRateIn, session: SessionDep, current: CurrentUser):
    return await _manager(session, current).add_vat_rate(data)


@router.delete("/vat-rates/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vat_rate(rate_id: int, session: SessionDep, current: CurrentUser):
    """Only changes orders saved from now on: saved lines keep the rate they were made with."""
    m = _manager(session, current)
    rate = await session.get(VatRate, rate_id)
    if rate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "VAT rate not found")
    await m.delete_vat_rate(rate)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- orders ----------


@router.get("/orders", response_model=OrderPage)
async def list_orders(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[OrderQuery, Query()],
):
    items, total, sums = await _manager(session, current).page(f, f.limit, f.offset)
    return OrderPage(items=items, total=total, sums=sums)


@router.get("/orders/export")
async def export_orders(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[OrderExport, Query()],
):
    """The list as filtered, as an Excel file."""
    lang = f.lang
    items, _, _ = await _manager(session, current).page(f, MAX_ROWS, 0)
    return xlsx(
        "orders",
        lang,
        [
            ("number", "int"),
            ("date", "date"),
            ("customer", "text"),
            ("status", "text"),
            ("total", "money"),
            ("unpaid", "money"),
            ("currency", "text"),
            ("due", "date"),
        ],
        [
            [
                o["number"],
                o["date"],
                o["customer_name"],
                word(STATUS, o["status"], lang),
                o["total"],
                o["unpaid"],
                o["currency"],
                o["due_date"],
            ]
            for o in items
        ],
    )


@router.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(data: OrderIn, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    order = await m.create(data)
    _log(session, current, order, "created")
    return await _out(m, order)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    return await _out(m, await _order(m, order_id))


@router.put("/orders/{order_id}", response_model=OrderOut)
async def replace_order(
    order_id: int, data: OrderIn, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    order = await m.replace(await _order(m, order_id), data)
    _log(session, current, order, "updated")
    return await _out(m, order)


@router.post("/orders/{order_id}/confirm", response_model=OrderOut)
async def confirm_order(order_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    order = await _order(m, order_id)
    negative = await m.confirm(order)
    _log(session, current, order, "confirmed")
    out = await _out(m, order, negative)
    warning = await DebtManager(session, current[1]).credit_warning(
        order.customer_id, order.currency
    )
    out.credit = warning and CreditWarning(**warning)
    return out


@router.post("/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_order(order_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    order = await _order(m, order_id)
    if order.status != "cancelled":
        await m.cancel(order)
        _log(session, current, order, "cancelled")
    return await _out(m, order)
