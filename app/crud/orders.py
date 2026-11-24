from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import InvalidField
from app.core.text import search_key
from app.crud.debts import debt_parts, returned_totals, today
from app.crud.rates import RatesManager
from app.core.clock import TASHKENT
from app.crud.stock import StockManager
from app.models import (
    Customer,
    OrderLine,
    PriceList,
    Product,
    SalesOrder,
    SalesReturn,
    Tenant,
    VatRate,
    Warehouse,
)
from app.schemas.order import OrderFilters, OrderIn, VatRateIn

CENT = Decimal("0.01")
# the list's sortable columns
ORDER_SORT = {
    "date": (SalesOrder.date,),
    "number": (SalesOrder.number,),
    "customer": (Customer.name_key,),
    "total": (SalesOrder.total,),
    "due": (SalesOrder.due_date,),
}


def money(d: Decimal) -> Decimal:
    return d.quantize(CENT, rounding=ROUND_HALF_UP)


def line_amounts(
    quantity: Decimal, price: Decimal, discount: Decimal, vat_rate: Decimal
) -> tuple[Decimal, Decimal]:
    """(amount, VAT inside it) for a line whose price includes VAT, after its discount (%)."""
    amount = money(quantity * price * (100 - discount) / 100)
    vat = money(amount * vat_rate / (100 + vat_rate)) if vat_rate else Decimal("0.00")
    return amount, vat


class OrderManager:
    """Sales orders and the company's VAT rates. Row-level security limits every query to the
    company set on the session (CurrentUser does that), so nothing here filters by tenant_id.
    """

    def __init__(
        self, session: AsyncSession, tenant: Tenant, user_id: int | None = None
    ):
        self.session = session
        self.tenant = tenant
        self.user_id = user_id
        self.stock = StockManager(session, tenant.id, user_id)

    # ---------- VAT ----------

    async def vat_rates(self) -> list[VatRate]:
        rows = await self.session.scalars(
            select(VatRate).order_by(VatRate.valid_from.desc())
        )
        return list(rows)

    async def add_vat_rate(self, data: VatRateIn) -> VatRate:
        rate = VatRate(tenant_id=self.tenant.id, **data.model_dump())
        self.session.add(rate)
        await self.session.flush()  # a second rate on the same date: 409
        return rate

    async def delete_vat_rate(self, rate: VatRate) -> None:
        await self.session.delete(rate)
        await self.session.flush()

    async def vat_on(self, day) -> Decimal:
        rate = await self.session.scalar(
            select(VatRate.rate)
            .where(VatRate.valid_from <= day)
            .order_by(VatRate.valid_from.desc())
            .limit(1)
        )
        return rate if rate is not None else Decimal("0.00")

    # ---------- orders ----------

    async def page(
        self, f: OrderFilters, limit: int, offset: int
    ) -> tuple[list[dict], int, list[dict]]:
        """Orders matching the filters, the page asked for, and per currency the confirmed ones'
        total and unpaid part."""
        lines = (
            select(OrderLine.order_id, func.count().label("n"))
            .group_by(OrderLine.order_id)
            .subquery()
        )
        parts = debt_parts()
        unpaid = (
            select(parts.c.id, parts.c.unpaid)
            .where(parts.c.kind == "order")
            .subquery("unpaid")
        )
        back = returned_totals()
        query = (
            select(
                SalesOrder,
                Customer.name.label("customer_name"),
                func.coalesce(lines.c.n, 0).label("lines"),
                unpaid.c.unpaid,
                func.coalesce(back.c.total, 0).label("returned_total"),
            )
            .join(Customer, Customer.id == SalesOrder.customer_id)
            .outerjoin(lines, lines.c.order_id == SalesOrder.id)
            .outerjoin(unpaid, unpaid.c.id == SalesOrder.id)
            .outerjoin(back, back.c.order_id == SalesOrder.id)
        )
        if f.status:
            query = query.where(SalesOrder.status == f.status)
        if f.customer_id:
            query = query.where(SalesOrder.customer_id == f.customer_id)
        if f.date_from:
            query = query.where(SalesOrder.date >= f.date_from)
        if f.date_to:
            query = query.where(SalesOrder.date <= f.date_to)
        if f.payment:
            query = query.where(SalesOrder.status == "confirmed", unpaid.c.unpaid > 0)
            if f.payment == "overdue":
                query = query.where(SalesOrder.due_date < today())
        for word in search_key(f.q).split():
            query = query.where(Customer.search.contains(word))
        found = query.subquery()
        count = await self.session.scalar(select(func.count()).select_from(found))
        sums = await self.session.execute(
            select(
                found.c.currency,
                func.sum(found.c.total),
                func.coalesce(func.sum(found.c.unpaid), 0),
            )
            .where(found.c.status == "confirmed")
            .group_by(found.c.currency)
            .order_by(found.c.currency)
        )
        column, *_ = ORDER_SORT[f.sort.lstrip("-")]
        direction = (
            column.desc().nulls_last() if f.sort.startswith("-") else column.asc()
        )
        rows = (
            await self.session.execute(
                query.order_by(direction, SalesOrder.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        items = [
            {
                "id": o.id,
                "number": o.number,
                "date": o.date,
                "status": o.status,
                "customer_id": o.customer_id,
                "customer_name": name,
                "currency": o.currency,
                "total": o.total,
                "lines": n,
                "due_date": o.due_date,
                "unpaid": left if o.status == "confirmed" else None,
                "returned_total": returned,
            }
            for o, name, n, left, returned in rows
        ]
        return (
            items,
            count or 0,
            [{"currency": c, "total": t, "unpaid": u} for c, t, u in sums],
        )

    async def unpaid(self, order: SalesOrder) -> Decimal | None:
        """What's left to pay of a confirmed order, the oldest debts paid first."""
        if order.status != "confirmed":
            return None
        parts = debt_parts()
        return await self.session.scalar(
            select(parts.c.unpaid).where(
                parts.c.kind == "order", parts.c.id == order.id
            )
        )

    async def get(self, order_id: int) -> SalesOrder | None:
        return await self.session.scalar(
            select(SalesOrder)
            .where(SalesOrder.id == order_id)
            .options(selectinload(SalesOrder.lines))
        )

    async def create(self, data: OrderIn) -> SalesOrder:
        order = SalesOrder(
            tenant_id=self.tenant.id,
            number=await self.stock.next_number("order"),
            created_by=self.user_id,
            lines=[],
        )
        await self._fill(order, data)
        self.session.add(order)
        await self.session.flush()
        return order

    async def replace(self, order: SalesOrder, data: OrderIn) -> SalesOrder:
        self._must_be_draft(order)
        await self._fill(order, data)
        await self.session.flush()
        return order

    async def confirm(self, order: SalesOrder) -> list[dict]:
        """Takes the goods out of the warehouse; returns what went below zero (allowed, reported)."""
        self._must_be_draft(order)
        if not order.lines:
            raise InvalidField("lines", "An order needs at least one line")
        if order.currency != self.tenant.currency:
            rates = RatesManager(self.session, self.tenant)
            order.exchange_rate = await rates.rate_of(order.currency)
        customer = await self.session.get(Customer, order.customer_id)
        order.due_date = order.date + timedelta(days=customer.payment_days or 0)
        order.status = "confirmed"
        order.confirmed_at = datetime.now(UTC)
        await self.session.flush()
        return await self.stock.negatives_for(
            [line.product_id for line in order.lines], {order.warehouse_id}
        )

    async def cancel(self, order: SalesOrder) -> None:
        """A draft or a confirmed order: its goods (if taken) go back; it stays in the history.
        Not while returns of it still count: their goods would come back a second time.
        """
        # waits for a return being saved for this order (ReturnManager.create locks it too)
        await self.session.execute(
            select(SalesOrder.id).where(SalesOrder.id == order.id).with_for_update()
        )
        if order.status == "confirmed" and await self.session.scalar(
            select(func.count()).where(
                SalesReturn.order_id == order.id, SalesReturn.cancelled_at.is_(None)
            )
        ):
            raise InvalidField("status", "Cancel the order's returns first")
        if order.status != "cancelled":
            order.status = "cancelled"
            order.cancelled_at = datetime.now(UTC)
            await self.session.flush()

    async def names(self, order: SalesOrder) -> tuple[str, dict[int, Product]]:
        customer = await self.session.get(Customer, order.customer_id)
        ids = {line.product_id for line in order.lines}
        products = await self.session.scalars(
            select(Product).where(Product.id.in_(ids))
        )
        return customer.name, {p.id: p for p in products}

    @staticmethod
    def _must_be_draft(order: SalesOrder) -> None:
        if order.status != "draft":
            raise InvalidField("status", "Only a draft can be changed")

    async def _fill(self, order: SalesOrder, data: OrderIn) -> None:
        customer = await self.session.scalar(
            select(Customer).where(
                Customer.id == data.customer_id, Customer.archived_at.is_(None)
            )
        )
        if customer is None:
            raise InvalidField("customer_id", "No such customer")
        warehouse = await self.session.scalar(
            select(Warehouse.id).where(
                (
                    Warehouse.id == data.warehouse_id
                    if data.warehouse_id
                    else Warehouse.is_default
                ),
                Warehouse.archived_at.is_(None),
            )
        )
        if warehouse is None:
            raise InvalidField("warehouse_id", "No such warehouse")
        list_id = data.price_list_id or customer.price_list_id
        price_list = await self.session.scalar(
            select(PriceList).where(
                PriceList.id == list_id if list_id else PriceList.is_default,
                PriceList.archived_at.is_(None),
            )
        )
        if price_list is None:
            raise InvalidField("price_list_id", "No such price list")
        ids = {line.product_id for line in data.lines}
        found = set(
            await self.session.scalars(
                select(Product.id).where(
                    Product.id.in_(ids), Product.archived_at.is_(None)
                )
            )
        )
        if found != ids:
            raise InvalidField("lines", "No such product")

        order.customer_id = customer.id
        order.warehouse_id = warehouse
        order.price_list_id = price_list.id
        order.currency = price_list.currency
        order.date = data.date or datetime.now(TASHKENT).date()
        order.note = data.note
        vat = await self.vat_on(order.date)
        order.lines.clear()
        total = vat_total = Decimal("0.00")
        for line in data.lines:
            amount, vat_amount = line_amounts(
                line.quantity, line.price, line.discount, vat
            )
            total += amount
            vat_total += vat_amount
            order.lines.append(
                OrderLine(
                    tenant_id=self.tenant.id,
                    product_id=line.product_id,
                    quantity=line.quantity,
                    price=line.price,
                    discount=line.discount,
                    amount=amount,
                    vat_rate=vat,
                    vat_amount=vat_amount,
                )
            )
        order.total = total
        order.vat_total = vat_total
