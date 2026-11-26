from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    OUTSIDE_PROFIT,
    MoneyMove,
    OrderLine,
    Product,
    ReturnLine,
    SalesOrder,
    SalesReturn,
    StockDocument,
    StockLine,
    Tenant,
)

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def unit_costs(currency: str, until: date):
    """What one unit of each product cost, in the company's currency: (product_id, cost), the
    average price of its priced receipts up to `until`, weighted by quantity. A receipt in
    another currency counts at its saved rate; one without a rate (not a purchase) is left out.
    shortcut: one average per product, so a period's profit moves a little when a later
    delivery inside it costs more; count by batch (FIFO) if owners need exact margins.
    """
    value = StockLine.price * func.coalesce(StockDocument.exchange_rate, 1)
    return (
        select(
            StockLine.product_id,
            (func.sum(StockLine.quantity * value) / func.sum(StockLine.quantity)).label(
                "cost"
            ),
        )
        .join(StockDocument, StockDocument.id == StockLine.document_id)
        .where(
            StockDocument.kind == "receipt",
            StockDocument.cancelled_at.is_(None),
            StockDocument.date <= until,
            StockLine.price.is_not(None),
            or_(
                StockDocument.currency == currency,
                StockDocument.exchange_rate.is_not(None),
            ),
        )
        .group_by(StockLine.product_id)
        .subquery("cost")
    )


class ProfitReport:
    """What the company earned in a period, in its own currency: sales less what the sold goods
    cost less the expenses. Sales are confirmed orders on their date, net of returns on the day
    the goods came back (the dashboard's figure), VAT included; taxes count when paid, as an
    expense. Other currencies count at the rate saved on each document."""

    def __init__(self, session: AsyncSession, tenant: Tenant):
        self.session = session
        self.tenant = tenant

    async def build(self, date_from: date, date_to: date) -> dict:
        s = self.session
        order_rate = func.coalesce(SalesOrder.exchange_rate, 1)
        return_rate = func.coalesce(SalesReturn.exchange_rate, 1)
        sold_in = (
            SalesOrder.status == "confirmed",
            SalesOrder.date.between(date_from, date_to),
        )
        back_in = (
            SalesReturn.cancelled_at.is_(None),
            SalesReturn.date.between(date_from, date_to),
        )
        # each document converted and rounded to the cent, as the dashboard does
        sold = await s.scalar(
            select(func.sum(func.round(SalesOrder.total * order_rate, 2))).where(
                *sold_in
            )
        )
        back = await s.scalar(
            select(func.sum(func.round(SalesReturn.total * return_rate, 2))).where(
                *back_in
            )
        )
        sales = (sold or ZERO) - (back or ZERO)

        # the goods behind those sales, per product: what left less what came back
        lines = union_all(
            select(
                OrderLine.product_id,
                OrderLine.quantity.label("quantity"),
                (OrderLine.amount * order_rate).label("amount"),
            )
            .join(SalesOrder, SalesOrder.id == OrderLine.order_id)
            .where(*sold_in),
            select(
                ReturnLine.product_id,
                -ReturnLine.quantity,
                -ReturnLine.amount * return_rate,
            )
            .join(SalesReturn, SalesReturn.id == ReturnLine.return_id)
            .where(*back_in),
        ).subquery("line")
        per = (
            select(
                lines.c.product_id,
                func.sum(lines.c.quantity).label("quantity"),
                func.sum(lines.c.amount).label("amount"),
            )
            .group_by(lines.c.product_id)
            .subquery("sold")
        )
        costs = unit_costs(self.tenant.currency, date_to)
        cost = ZERO
        uncosted = []
        for product_id, name, quantity, amount, unit in await s.execute(
            select(Product.id, Product.name, per.c.quantity, per.c.amount, costs.c.cost)
            .join(Product, Product.id == per.c.product_id)
            .outerjoin(costs, costs.c.product_id == per.c.product_id)
            .order_by(per.c.amount.desc(), Product.id)
        ):
            if unit is not None:
                cost += (quantity * unit).quantize(CENT, ROUND_HALF_UP)
            elif (
                quantity
            ):  # never bought at a price: its sales would look like pure profit
                uncosted.append(
                    {"id": product_id, "name": name, "sales": amount.quantize(CENT)}
                )

        in_main = func.sum(
            func.round(MoneyMove.amount * func.coalesce(MoneyMove.exchange_rate, 1), 2)
        )
        counted = (
            MoneyMove.cancelled_at.is_(None),
            MoneyMove.date.between(date_from, date_to),
            MoneyMove.category.not_in(OUTSIDE_PROFIT),
        )
        expenses = [
            {"category": c, "amount": a}
            for c, a in await s.execute(
                select(MoneyMove.category, in_main)
                .where(MoneyMove.kind == "expense", *counted)
                .group_by(MoneyMove.category)
                .order_by(in_main.desc(), MoneyMove.category)
            )
        ]
        other_income = (
            await s.scalar(select(in_main).where(MoneyMove.kind == "income", *counted))
            or ZERO
        )
        spent = sum((e["amount"] for e in expenses), ZERO)
        return {
            "currency": self.tenant.currency,
            "sales": sales,
            "cost": cost,
            "gross": sales - cost,
            "expenses": expenses,
            "expenses_total": spent,
            "other_income": other_income,
            "profit": sales - cost - spent + other_income,
            "uncosted": {
                "count": len(uncosted),
                "sales": sum((u["sales"] for u in uncosted), ZERO),
                "products": uncosted[:10],  # the biggest sellers first
            },
        }
