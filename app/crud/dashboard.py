from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.debts import DebtManager, today
from app.crud.orders import OrderManager
from app.crud.stock import stock_totals
from app.crud.tasks import TaskManager
from app.models import Payment, Product, SalesOrder, SalesReturn, Tenant
from app.schemas.order import OrderFilters
from app.schemas.payment import DebtFilters

DAYS = 30


def month_start(d: date) -> date:
    return d.replace(day=1)


class Dashboard:
    """The owner's overview, in one request. Money in other currencies counts at the rate saved
    on each document, so sales and payments add up in the company's own currency."""

    def __init__(self, session: AsyncSession, tenant: Tenant, user_id: int):
        self.session = session
        self.tenant = tenant
        self.user_id = user_id

    async def build(self, with_tasks: bool = True) -> dict:
        day = today()
        month = month_start(day)
        # the same stretch of last month (1st to today's day number), to compare like with like
        prev = month_start(month - timedelta(days=1))
        prev_end = min(prev + (day - month), month - timedelta(days=1))
        start = day - timedelta(days=DAYS - 1)

        # each document converted and rounded to the cent, as its own total would be
        in_main = func.round(
            SalesOrder.total * func.coalesce(SalesOrder.exchange_rate, 1), 2
        )
        confirmed = SalesOrder.status == "confirmed"
        per_day = dict(
            (
                await self.session.execute(
                    select(SalesOrder.date, func.sum(in_main))
                    .where(confirmed, SalesOrder.date >= min(start, prev))
                    .group_by(SalesOrder.date)
                )
            ).all()
        )
        zero = Decimal("0.00")
        # sales are net of returns, counted on the day the goods came back
        back = func.round(
            SalesReturn.total * func.coalesce(SalesReturn.exchange_rate, 1), 2
        )
        for d, v in (
            await self.session.execute(
                select(SalesReturn.date, func.sum(back))
                .where(
                    SalesReturn.cancelled_at.is_(None),
                    SalesReturn.date >= min(start, prev),
                )
                .group_by(SalesReturn.date)
            )
        ).all():
            per_day[d] = per_day.get(d, zero) - v

        def total(a: date, b: date) -> Decimal:
            return sum((v for d, v in per_day.items() if a <= d <= b), zero)

        orders_today = await self.session.scalar(
            select(func.count()).where(confirmed, SalesOrder.date == day)
        )
        drafts = await self.session.scalar(
            select(func.count()).where(SalesOrder.status == "draft")
        )
        paid = func.round(Payment.amount * func.coalesce(Payment.exchange_rate, 1), 2)
        received_today, received_month = (
            await self.session.execute(
                select(
                    func.coalesce(func.sum(case((Payment.date == day, paid))), 0),
                    func.coalesce(func.sum(paid), 0),
                ).where(Payment.cancelled_at.is_(None), Payment.date >= month)
            )
        ).one()

        debts = DebtManager(self.session, self.tenant)
        top, _, totals = await debts.page(DebtFilters(), 5, 0)
        overdue_count = (await debts.page(DebtFilters(overdue=True), 1, 0))[1]

        tasks = TaskManager(self.session, self.tenant.id, self.user_id)
        task_summary, due_tasks = {"overdue": 0, "today": 0}, []
        if with_tasks:
            task_summary = await tasks.summary()
            open_tasks, _ = await tasks.page("open", None, None, 6, 0)
            due_tasks = [
                t for t in open_tasks if t["due_date"] and t["due_date"] <= day
            ]

        totals_q = stock_totals()
        stock = func.coalesce(totals_q.c.total, 0)
        alerts = (
            select(Product, stock.label("stock"))
            .outerjoin(totals_q, totals_q.c.product_id == Product.id)
            .where(
                Product.archived_at.is_(None),
                (stock < 0) | (stock < Product.min_stock),
            )
        )
        found = alerts.subquery()
        negative, low = (
            await self.session.execute(
                select(
                    func.count(case((found.c.stock < 0, 1))),
                    func.count(case((found.c.stock >= 0, 1))),
                )
            )
        ).one()
        alert_rows = (
            await self.session.execute(
                alerts.order_by(stock.asc(), Product.name_key).limit(6)
            )
        ).all()

        recent, _, _ = await OrderManager(self.session, self.tenant).page(
            OrderFilters(), 6, 0
        )
        return {
            "currency": self.tenant.currency,
            "sales": {
                "today": total(day, day),
                "month": total(month, day),
                "prev_month": total(prev, prev_end),
                "orders_today": orders_today or 0,
                "drafts": drafts or 0,
            },
            "received": {"today": received_today, "month": received_month},
            "daily": [
                {"date": d, "total": per_day.get(d, zero)}
                for d in (start + timedelta(days=i) for i in range(DAYS))
            ],
            "debts": {
                "totals": totals,
                "top": [d for d in top if Decimal(d["balance"]) > 0],
                "overdue_customers": overdue_count,
            },
            "tasks": {**task_summary, "items": due_tasks},
            "stock": {
                "negative": negative,
                "low": low,
                "items": [
                    {
                        "product_id": p.id,
                        "name": p.name,
                        "unit": p.unit,
                        "stock": s,
                        "min_stock": p.min_stock,
                    }
                    for p, s in alert_rows
                ],
            },
            "recent": recent,
        }
