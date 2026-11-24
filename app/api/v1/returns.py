from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.crud.activity import ActivityLog
from app.crud.orders import OrderManager
from app.crud.returns import ReturnManager
from app.models import SalesReturn
from app.schemas.order import ReturnIn, ReturnOut

router = APIRouter(tags=["Returns"])


def _manager(session, current) -> ReturnManager:
    user, tenant = current
    return ReturnManager(session, tenant, user.id)


def _log(session, current, ret: SalesReturn, order_number: int, action: str) -> None:
    user, tenant = current
    ActivityLog(session, tenant.id, user.id).add(
        "return",
        ret.id,
        action,
        ret.customer_id,
        number=ret.number,
        order_id=ret.order_id,
        order_number=order_number,
        total=ret.total,
        currency=ret.currency,
    )


async def _out(m: ReturnManager, ret: SalesReturn, negative=()) -> ReturnOut:
    customer, order_number, order_lines, products = await m.names(ret)
    return ReturnOut(
        id=ret.id,
        number=ret.number,
        date=ret.date,
        order_id=ret.order_id,
        order_number=order_number,
        customer_id=ret.customer_id,
        customer_name=customer,
        warehouse_id=ret.warehouse_id,
        currency=ret.currency,
        exchange_rate=ret.exchange_rate,
        total=ret.total,
        vat_total=ret.vat_total,
        note=ret.note,
        created_at=ret.created_at,
        cancelled=ret.cancelled,
        lines=[
            {
                "id": line.id,
                "order_line_id": line.order_line_id,
                "product_id": line.product_id,
                "product_name": products[line.product_id].name,
                "unit": products[line.product_id].unit,
                "quantity": line.quantity,
                "price": order_lines[line.order_line_id].price,
                "discount": order_lines[line.order_line_id].discount,
                "amount": line.amount,
                "vat_rate": order_lines[line.order_line_id].vat_rate,
                "vat_amount": line.vat_amount,
            }
            for line in ret.lines
        ],
        negative=list(negative),
    )


async def _return(m: ReturnManager, return_id: int) -> SalesReturn:
    ret = await m.get(return_id)
    if ret is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Return not found")
    return ret


@router.post(
    "/orders/{order_id}/returns",
    response_model=ReturnOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_return(
    order_id: int, data: ReturnIn, session: SessionDep, current: CurrentUser
):
    user, tenant = current
    order = await OrderManager(session, tenant, user.id).get(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    m = _manager(session, current)
    ret = await m.create(order, data)
    _log(session, current, ret, order.number, "created")
    return await _out(m, ret)


@router.get("/returns/{return_id}", response_model=ReturnOut)
async def get_return(return_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    return await _out(m, await _return(m, return_id))


@router.post("/returns/{return_id}/cancel", response_model=ReturnOut)
async def cancel_return(return_id: int, session: SessionDep, current: CurrentUser):
    m = _manager(session, current)
    ret = await _return(m, return_id)
    if ret.cancelled:
        return await _out(m, ret)
    negative = await m.cancel(ret)
    out = await _out(m, ret, negative)
    _log(session, current, ret, out.order_number, "cancelled")
    return out
