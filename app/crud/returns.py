from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import InvalidField
from app.crud.orders import line_amounts
from app.core.clock import TASHKENT
from app.crud.stock import StockManager
from app.models import (
    Customer,
    OrderLine,
    Product,
    ReturnLine,
    SalesOrder,
    SalesReturn,
    Tenant,
)
from app.schemas.order import ReturnIn

ZERO = Decimal("0.00")


class ReturnManager:
    """Goods customers bring back from confirmed orders. Row-level security limits every query to
    the company set on the session, so nothing here filters by tenant_id."""

    def __init__(
        self, session: AsyncSession, tenant: Tenant, user_id: int | None = None
    ):
        self.session = session
        self.tenant = tenant
        self.user_id = user_id
        self.stock = StockManager(session, tenant.id, user_id)

    async def get(self, return_id: int) -> SalesReturn | None:
        return await self.session.scalar(
            select(SalesReturn)
            .where(SalesReturn.id == return_id)
            .options(selectinload(SalesReturn.lines))
        )

    async def of_order(self, order_id: int) -> list[SalesReturn]:
        return list(
            await self.session.scalars(
                select(SalesReturn)
                .where(SalesReturn.order_id == order_id)
                .order_by(SalesReturn.date, SalesReturn.number)
            )
        )

    async def returned(
        self, order_id: int
    ) -> dict[int, tuple[Decimal, Decimal, Decimal]]:
        """Order line id -> (quantity, amount, VAT) already brought back by its returns that
        still count."""
        rows = await self.session.execute(
            select(
                ReturnLine.order_line_id,
                func.sum(ReturnLine.quantity),
                func.sum(ReturnLine.amount),
                func.sum(ReturnLine.vat_amount),
            )
            .join(SalesReturn, SalesReturn.id == ReturnLine.return_id)
            .where(SalesReturn.order_id == order_id, SalesReturn.cancelled_at.is_(None))
            .group_by(ReturnLine.order_line_id)
        )
        return {line: (q, a, v) for line, q, a, v in rows}

    async def create(self, order: SalesOrder, data: ReturnIn) -> SalesReturn:
        # one at a time per order: two returns saved at once would each see the same quantity
        # left, and an order cancelled meanwhile would bring the goods back twice
        status = await self.session.scalar(
            select(SalesOrder.status).where(SalesOrder.id == order.id).with_for_update()
        )
        if status != "confirmed":
            raise InvalidField("order_id", "Only a confirmed order's goods come back")
        day = data.date or datetime.now(TASHKENT).date()
        if day < order.date:
            raise InvalidField("date", "A return can't come before its order")
        warehouse_id = data.warehouse_id or order.warehouse_id
        await self.stock.check_warehouse("warehouse_id", warehouse_id)
        sold = {line.id: line for line in order.lines}
        ids = [line.order_line_id for line in data.lines]
        if len(set(ids)) != len(ids) or not set(ids) <= set(sold):
            raise InvalidField("lines", "Each line once, and only the order's own")
        before = await self.returned(order.id)

        lines, total, vat_total = [], ZERO, ZERO
        for asked in data.lines:
            line = sold[asked.order_line_id]
            q0, a0, v0 = before.get(line.id, (0, ZERO, ZERO))
            if q0 + asked.quantity > line.quantity:
                raise InvalidField("lines", "More than was sold, less what came back")
            if q0 + asked.quantity == line.quantity:
                # the last of the line: what's left of its amounts, so the returns add up to the
                # sale to the cent whatever the earlier ones rounded to
                amount, vat = line.amount - a0, line.vat_amount - v0
            else:
                amount, vat = line_amounts(
                    asked.quantity, line.price, line.discount, line.vat_rate
                )
            total += amount
            vat_total += vat
            lines.append(
                ReturnLine(
                    tenant_id=self.tenant.id,
                    order_line_id=line.id,
                    product_id=line.product_id,
                    quantity=asked.quantity,
                    amount=amount,
                    vat_amount=vat,
                )
            )
        ret = SalesReturn(
            tenant_id=self.tenant.id,
            number=await self.stock.next_number("return"),
            date=day,
            order_id=order.id,
            customer_id=order.customer_id,
            warehouse_id=warehouse_id,
            currency=order.currency,
            exchange_rate=order.exchange_rate,
            total=total,
            vat_total=vat_total,
            note=data.note,
            created_by=self.user_id,
            lines=lines,
        )
        self.session.add(ret)
        await self.session.flush()
        return ret

    async def cancel(self, ret: SalesReturn) -> list[dict]:
        """The goods leave the warehouse again and the debt comes back; returns what went below
        zero (allowed, reported, as with any stock that leaves)."""
        if ret.cancelled:
            return []
        ret.cancelled_at = datetime.now(UTC)
        await self.session.flush()
        return await self.stock.negatives_for(
            [line.product_id for line in ret.lines], {ret.warehouse_id}
        )

    async def has_active(self, order_id: int) -> bool:
        return bool(
            await self.session.scalar(
                select(func.count()).where(
                    SalesReturn.order_id == order_id,
                    SalesReturn.cancelled_at.is_(None),
                )
            )
        )

    async def names(self, ret: SalesReturn) -> tuple[str, int, dict, dict]:
        """The customer's name, the order's number, its lines and the products, for showing."""
        customer = await self.session.get(Customer, ret.customer_id)
        order = await self.session.get(SalesOrder, ret.order_id)
        line_ids = [line.order_line_id for line in ret.lines]
        order_lines = {
            ol.id: ol
            for ol in await self.session.scalars(
                select(OrderLine).where(OrderLine.id.in_(line_ids))
            )
        }
        products = {
            p.id: p
            for p in await self.session.scalars(
                select(Product).where(
                    Product.id.in_({line.product_id for line in ret.lines})
                )
            )
        }
        return customer.name, order.number, order_lines, products
