from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, distinct, func, null, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.profit import unit_costs
from app.models import (
    Customer,
    OrderLine,
    Product,
    ReturnLine,
    SalesOrder,
    SalesReturn,
    Tenant,
    User,
)

ZERO = Decimal("0.00")
BY = ("product", "customer", "manager")
SORTS = ("name", "orders", "quantity", "sales", "profit")


class SalesReport:
    """A period's sales by product, by customer or by who entered the order, in the company's
    currency: confirmed orders on their date less returns on theirs (a return counts for the
    person who made the sale), VAT included, each line at its document's saved rate. Cost is the
    profit report's (`unit_costs`): what was sold times the product's average purchase price.
    A sale of a product with no known cost counts as all profit, so each row also says how much
    of its sales that is (`uncosted`).
    shortcut: every row comes back at once; page it when a firm sells thousands of products a
    month."""

    def __init__(self, session: AsyncSession, tenant: Tenant):
        self.session = session
        self.tenant = tenant

    async def build(
        self, by: str, date_from: date, date_to: date, sort: str, with_cost: bool
    ) -> dict:
        order_rate = func.coalesce(SalesOrder.exchange_rate, 1)
        return_rate = func.coalesce(SalesReturn.exchange_rate, 1)
        line = union_all(
            select(
                OrderLine.product_id,
                SalesOrder.customer_id,
                SalesOrder.created_by.label("user_id"),
                SalesOrder.id.label("order_id"),
                OrderLine.quantity.label("quantity"),
                (OrderLine.amount * order_rate).label("amount"),
            )
            .join(SalesOrder, SalesOrder.id == OrderLine.order_id)
            .where(
                SalesOrder.status == "confirmed",
                SalesOrder.date.between(date_from, date_to),
            ),
            select(
                ReturnLine.product_id,
                SalesReturn.customer_id,
                SalesOrder.created_by,
                null().cast(BigInteger),  # a return isn't one more order
                -ReturnLine.quantity,
                -ReturnLine.amount * return_rate,
            )
            .join(SalesReturn, SalesReturn.id == ReturnLine.return_id)
            .join(SalesOrder, SalesOrder.id == SalesReturn.order_id)
            .where(
                SalesReturn.cancelled_at.is_(None),
                SalesReturn.date.between(date_from, date_to),
            ),
        ).subquery("line")
        costs = unit_costs(self.tenant.currency, date_to)
        key = {
            "product": line.c.product_id,
            "customer": line.c.customer_id,
            "manager": line.c.user_id,
        }[by]
        sales = func.round(func.sum(line.c.amount), 2)
        cost = func.round(func.coalesce(func.sum(line.c.quantity * costs.c.cost), 0), 2)
        g = (
            select(
                key.label("id"),
                func.count(distinct(line.c.order_id)).label("orders"),
                func.sum(line.c.quantity).label("quantity"),
                sales.label("sales"),
                cost.label("cost"),
                (sales - cost).label("profit"),
                func.round(
                    func.coalesce(
                        func.sum(line.c.amount).filter(costs.c.cost.is_(None)), 0
                    ),
                    2,
                ).label("uncosted"),
            )
            .select_from(line.outerjoin(costs, costs.c.product_id == line.c.product_id))
            .group_by(key)
            .subquery("g")
        )
        named = {"product": Product, "customer": Customer, "manager": User}[by]
        unit = Product.unit if by == "product" else null()
        field = sort.lstrip("-")
        if field == "profit" and not with_cost:
            field, sort = "sales", "-sales"
        column = named.name if field == "name" else g.c[field]
        rows = await self.session.execute(
            select(g, named.name, unit.label("unit"))
            # outer: the person who entered an order may have been removed since
            .outerjoin(named, named.id == g.c.id).order_by(
                column.desc() if sort.startswith("-") else column, g.c.id
            )
        )
        items = [
            {
                "id": r.id,
                "name": r.name,
                "unit": r.unit,
                "orders": r.orders,
                "quantity": r.quantity,
                "sales": r.sales,
                "cost": r.cost if with_cost else None,
                "profit": r.profit if with_cost else None,
                "uncosted": r.uncosted if with_cost else None,
            }
            for r in rows
        ]
        total = sum((i["sales"] for i in items), ZERO)
        spent = sum((i["cost"] for i in items), ZERO) if with_cost else None
        return {
            "currency": self.tenant.currency,
            "items": items,
            "sales": total,
            "cost": spent,
            "profit": total - spent if with_cost else None,
        }
