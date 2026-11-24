from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    Integer,
    Numeric,
    String,
    and_,
    case,
    func,
    literal,
    select,
    union_all,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidField
from app.core.text import search_key
from app.crud.rates import RatesManager
from app.core import clock
from app.crud.stock import StockManager
from app.models import (
    Customer,
    OpeningBalance,
    Payment,
    PriceList,
    SalesOrder,
    SalesReturn,
    Tenant,
)
from app.schemas.payment import DebtFilters, OpeningIn, PaymentFilters, PaymentIn

ZERO = Decimal("0.00")
# a plain 0 in SQL comes back as "0", not "0.00"
NOTHING = literal(ZERO, Numeric(18, 2))


def today() -> date:
    return clock.today()


def ledger():
    """Everything that changes what a customer owes, one row each: (customer_id, currency, date,
    due, kind, id, number, amount), the amount positive when it adds to the debt. Confirmed
    orders and opening debts add; payments, returns (and money paid ahead before we started)
    take away. Cancelled ones don't count. Debts are sums of this, so nothing can drift out of step.
    shortcut: summed on every read, like stock; add a balance table if it gets slow."""
    opening = select(
        OpeningBalance.customer_id,
        OpeningBalance.currency,
        OpeningBalance.date,
        OpeningBalance.date.label("due"),
        literal("opening", String).label("kind"),
        OpeningBalance.id,
        literal(None, Integer).label("number"),
        OpeningBalance.amount,
    )
    orders = select(
        SalesOrder.customer_id,
        SalesOrder.currency,
        SalesOrder.date,
        func.coalesce(SalesOrder.due_date, SalesOrder.date),
        literal("order", String),
        SalesOrder.id,
        SalesOrder.number,
        SalesOrder.total,
    ).where(SalesOrder.status == "confirmed")
    payments = select(
        Payment.customer_id,
        Payment.currency,
        Payment.date,
        Payment.date,
        literal("payment", String),
        Payment.id,
        Payment.number,
        -Payment.amount,
    ).where(Payment.cancelled_at.is_(None))
    returns = select(
        SalesReturn.customer_id,
        SalesReturn.currency,
        SalesReturn.date,
        SalesReturn.date,
        literal("return", String),
        SalesReturn.id,
        SalesReturn.number,
        -SalesReturn.total,
    ).where(SalesReturn.cancelled_at.is_(None))
    return union_all(opening, orders, payments, returns).subquery("ledger")


def returned_totals():
    """(order_id, total) of each order's returns that still count."""
    return (
        select(SalesReturn.order_id, func.sum(SalesReturn.total).label("total"))
        .where(SalesReturn.cancelled_at.is_(None))
        .group_by(SalesReturn.order_id)
        .subquery("returned")
    )


def debt_parts():
    """Each debt (an opening debt or a confirmed order) with the part of it still unpaid. Payments
    cover the oldest debts first (FIFO), so a debt's unpaid part is what's left of it after all
    the money received, counted from the oldest: clamp(debts up to and including it - paid).
    A return isn't money: it makes its own order smaller (the goods came back from that sale),
    so an order's debt here is its total less its returns, and a fully returned one is gone.
    """
    e = ledger()
    key = (e.c.customer_id, e.c.currency)
    paid = (
        select(*key, func.sum(-e.c.amount).label("paid"))
        .where(e.c.amount < 0, e.c.kind != "return")
        .group_by(*key)
        .subquery("paid")
    )
    back = returned_totals()
    net = (
        select(
            *key,
            e.c.date,
            e.c.kind,
            e.c.id,
            e.c.due,
            (e.c.amount - func.coalesce(back.c.total, NOTHING)).label("amount"),
        )
        .outerjoin(back, and_(e.c.kind == "order", back.c.order_id == e.c.id))
        .where(e.c.amount > 0)
        .subquery("net")
    )
    nkey = (net.c.customer_id, net.c.currency)
    owed = (
        select(
            *nkey,
            net.c.kind,
            net.c.id,
            net.c.amount,
            net.c.due,
            func.sum(net.c.amount)
            .over(partition_by=nkey, order_by=(net.c.date, net.c.kind, net.c.id))
            .label("upto"),
        )
        .where(net.c.amount > 0)
        .subquery("owed")
    )
    unpaid = func.greatest(
        NOTHING,
        func.least(owed.c.amount, owed.c.upto - func.coalesce(paid.c.paid, NOTHING)),
    )
    return (
        select(
            owed.c.customer_id,
            owed.c.currency,
            owed.c.kind,
            owed.c.id,
            owed.c.amount,
            owed.c.due,
            unpaid.label("unpaid"),
        )
        .outerjoin(
            paid,
            and_(
                paid.c.customer_id == owed.c.customer_id,
                paid.c.currency == owed.c.currency,
            ),
        )
        .subquery("parts")
    )


def debts(on: date):
    """Per customer and currency: the balance, and how much of it is overdue on `on`."""
    e = ledger()
    key = (e.c.customer_id, e.c.currency)
    parts = debt_parts()
    late = (
        select(
            parts.c.customer_id,
            parts.c.currency,
            func.sum(case((parts.c.due < on, parts.c.unpaid), else_=NOTHING)).label(
                "overdue"
            ),
            func.min(
                case((and_(parts.c.due < on, parts.c.unpaid > 0), parts.c.due))
            ).label("late_since"),
        )
        .group_by(parts.c.customer_id, parts.c.currency)
        .subquery("late")
    )
    balance = (
        select(
            *key,
            func.sum(e.c.amount).label("balance"),
            func.max(case((e.c.kind == "payment", e.c.date))).label("last_payment"),
        )
        .group_by(*key)
        .subquery("balance")
    )
    return (
        select(
            balance.c.customer_id,
            Customer.name.label("customer_name"),
            Customer.search,
            balance.c.currency,
            balance.c.balance,
            func.coalesce(late.c.overdue, NOTHING).label("overdue"),
            late.c.late_since,
            balance.c.last_payment,
        )
        .join(Customer, Customer.id == balance.c.customer_id)
        .outerjoin(
            late,
            and_(
                late.c.customer_id == balance.c.customer_id,
                late.c.currency == balance.c.currency,
            ),
        )
        .subquery("debts")
    )


PAYMENT_SORT = {
    "date": Payment.date,
    "number": Payment.number,
    "customer": Customer.name_key,
    "amount": Payment.amount,
}

DEBT_FIELDS = (
    "customer_id",
    "customer_name",
    "currency",
    "balance",
    "overdue",
    "late_since",
    "last_payment",
)


class DebtManager:
    """Payments, opening debts and what customers owe. Row-level security limits every query to
    the company set on the session, so nothing here filters by tenant_id."""

    def __init__(
        self, session: AsyncSession, tenant: Tenant, user_id: int | None = None
    ):
        self.session = session
        self.tenant = tenant
        self.user_id = user_id

    # ---------- debts ----------

    async def page(
        self, f: DebtFilters, limit: int, offset: int
    ) -> tuple[list[dict], int, list[dict]]:
        q, overdue, sort = f.q, f.overdue, f.sort
        d = debts(today())
        query = select(d).where(d.c.balance != 0)
        if overdue:
            query = query.where(d.c.overdue > 0)
        for word in search_key(q).split():
            query = query.where(d.c.search.contains(word))
        found = query.subquery()
        count = await self.session.scalar(select(func.count()).select_from(found))
        totals = await self.session.execute(
            select(
                found.c.currency,
                func.sum(case((found.c.balance > 0, found.c.balance), else_=NOTHING)),
                func.sum(found.c.overdue),
            )
            .group_by(found.c.currency)
            .order_by(found.c.currency)
        )
        order = (
            (found.c.late_since.asc().nulls_last(), found.c.overdue.desc())
            if sort == "late"
            else (found.c.balance.desc(),)
        )
        rows = await self.session.execute(
            select(*(found.c[f] for f in DEBT_FIELDS))
            .order_by(*order, found.c.customer_name, found.c.currency)
            .limit(limit)
            .offset(offset)
        )
        return (
            [dict(r._mapping) for r in rows],
            count or 0,
            [
                {"currency": c, "owed": owed, "overdue": late}
                for c, owed, late in totals
            ],
        )

    async def balances(self, customer: Customer) -> list[dict]:
        """Every currency the customer has dealt in, zero balances too, with its opening debt."""
        d = debts(today())
        rows = await self.session.execute(
            select(*(d.c[f] for f in DEBT_FIELDS))
            .where(d.c.customer_id == customer.id)
            .order_by(d.c.currency)
        )
        openings = {
            o.currency: o
            for o in await self.session.scalars(
                select(OpeningBalance).where(OpeningBalance.customer_id == customer.id)
            )
        }
        return [{**r._mapping, "opening": openings.get(r.currency)} for r in rows.all()]

    async def balances_of(self, customer_ids: list[int]) -> dict[int, list[dict]]:
        """customer id -> [{currency, balance, overdue}], zero balances left out."""
        out: dict[int, list[dict]] = {}
        if not customer_ids:
            return out
        d = debts(today())
        rows = await self.session.execute(
            select(d.c.customer_id, d.c.currency, d.c.balance, d.c.overdue)
            .where(d.c.customer_id.in_(customer_ids), d.c.balance != 0)
            .order_by(d.c.currency)
        )
        for cid, currency, balance, overdue in rows:
            out.setdefault(cid, []).append(
                {"currency": currency, "balance": balance, "overdue": overdue}
            )
        return out

    async def balance(self, customer_id: int, currency: str) -> Decimal:
        e = ledger()
        total = await self.session.scalar(
            select(func.sum(e.c.amount)).where(
                e.c.customer_id == customer_id, e.c.currency == currency
            )
        )
        return total or ZERO

    async def statement(
        self,
        customer: Customer,
        currency: str,
        date_from: date | None,
        date_to: date,
    ) -> dict:
        e = ledger()
        mine = (e.c.customer_id == customer.id, e.c.currency == currency)
        opening = ZERO
        if date_from:
            opening = (
                await self.session.scalar(
                    select(func.sum(e.c.amount)).where(*mine, e.c.date < date_from)
                )
                or ZERO
            )
        period = [e.c.date <= date_to] + ([e.c.date >= date_from] if date_from else [])
        entries = await self.session.execute(
            select(e.c.date, e.c.kind, e.c.id, e.c.number, e.c.amount)
            .where(*mine, *period)
            .order_by(e.c.date, e.c.kind, e.c.id)
        )
        rows, running = [], opening
        debit = credit = ZERO
        for day, kind, id_, number, amount in entries:
            running += amount
            plus, minus = (amount, ZERO) if amount > 0 else (ZERO, -amount)
            debit += plus
            credit += minus
            rows.append(
                {
                    "date": day,
                    "kind": kind,
                    "id": id_,
                    "number": number,
                    "debit": plus,
                    "credit": minus,
                    "balance": running,
                }
            )
        return {
            "customer_id": customer.id,
            "customer_name": customer.name,
            "currency": currency,
            "date_from": date_from,
            "date_to": date_to,
            "opening": opening,
            "rows": rows,
            "debit": debit,
            "credit": credit,
            "closing": running,
        }

    async def credit_warning(self, customer_id: int, currency: str) -> dict | None:
        """The customer's limit and debt when the debt in this currency is above it."""
        customer = await self.session.get(Customer, customer_id)
        if customer.credit_limit is None or customer.credit_currency != currency:
            return None
        debt = await self.balance(customer_id, currency)
        if debt <= customer.credit_limit:
            return None
        return {"currency": currency, "limit": customer.credit_limit, "debt": debt}

    # ---------- opening debts ----------

    async def set_opening(
        self, customer: Customer, currency: str, data: OpeningIn
    ) -> None:
        stmt = insert(OpeningBalance).values(
            tenant_id=self.tenant.id,
            customer_id=customer.id,
            currency=currency,
            **data.model_dump(),
        )
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=["tenant_id", "customer_id", "currency"],
                set_=data.model_dump(),
            )
        )

    async def delete_opening(self, customer: Customer, currency: str) -> bool:
        opening = await self.session.scalar(
            select(OpeningBalance).where(
                OpeningBalance.customer_id == customer.id,
                OpeningBalance.currency == currency,
            )
        )
        if opening is None:
            return False
        await self.session.delete(opening)
        await self.session.flush()
        return True

    # ---------- payments ----------

    def _payments(self):
        return select(Payment, Customer.name).join(
            Customer, Customer.id == Payment.customer_id
        )

    @staticmethod
    def _row(payment: Payment, name: str) -> dict:
        return {
            **{c.key: getattr(payment, c.key) for c in Payment.__table__.columns},
            "customer_name": name,
        }

    async def payments(
        self, f: PaymentFilters, limit: int, offset: int
    ) -> tuple[list[dict], int, list[dict]]:
        query = self._payments()
        if f.customer_id:
            query = query.where(Payment.customer_id == f.customer_id)
        if f.date_from:
            query = query.where(Payment.date >= f.date_from)
        if f.date_to:
            query = query.where(Payment.date <= f.date_to)
        if f.method:
            query = query.where(Payment.method == f.method)
        for word in search_key(f.q).split():
            query = query.where(Customer.search.contains(word))
        found = query.subquery()
        count = await self.session.scalar(select(func.count()).select_from(found))
        sums = await self.session.execute(
            select(found.c.currency, func.sum(found.c.amount))
            .where(found.c.cancelled_at.is_(None))
            .group_by(found.c.currency)
            .order_by(found.c.currency)
        )
        column = PAYMENT_SORT[f.sort.lstrip("-")]
        direction = column.desc() if f.sort.startswith("-") else column.asc()
        rows = await self.session.execute(
            query.order_by(direction, Payment.id.desc()).limit(limit).offset(offset)
        )
        return (
            [self._row(p, n) for p, n in rows],
            count or 0,
            [{"currency": c, "amount": a} for c, a in sums],
        )

    async def payment(self, payment_id: int) -> dict | None:
        row = (
            await self.session.execute(self._payments().where(Payment.id == payment_id))
        ).first()
        return self._row(*row) if row else None

    async def add_payment(self, data: PaymentIn) -> int:
        # an archived customer may still pay off what they owe
        customer = await self.session.get(Customer, data.customer_id)
        if customer is None:
            raise InvalidField("customer_id", "No such customer")
        currency = data.currency or await self.session.scalar(
            select(PriceList.currency).where(
                PriceList.id == customer.price_list_id
                if customer.price_list_id
                else PriceList.is_default
            )
        )
        rate = None
        if currency != self.tenant.currency:
            rate = await RatesManager(self.session, self.tenant).rate_of(currency)
        stock = StockManager(self.session, self.tenant.id, self.user_id)
        payment = Payment(
            tenant_id=self.tenant.id,
            number=await stock.next_number("payment"),
            date=data.date or today(),
            customer_id=customer.id,
            amount=data.amount,
            currency=currency,
            exchange_rate=rate,
            method=data.method,
            note=data.note,
            created_by=self.user_id,
        )
        self.session.add(payment)
        await self.session.flush()
        return payment.id

    async def cancel_payment(self, payment_id: int) -> bool:
        payment = await self.session.get(Payment, payment_id)
        if payment is None:
            return False
        if payment.cancelled_at is None:
            payment.cancelled_at = datetime.now(UTC)
            await self.session.flush()
        return True
