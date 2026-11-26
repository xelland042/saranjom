from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    String,
    and_,
    case,
    cast,
    false,
    func,
    literal_column,
    null,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import InvalidField
from app.crud.rates import RatesManager
from app.crud.stock import StockManager
from app.models import (
    EXPENSES,
    INCOMES,
    Customer,
    MoneyMove,
    Payment,
    Supplier,
    SupplierPayment,
    Tenant,
)
from app.schemas.money import MoneyFilters, MoveIn


def _place(method):
    # cash is in the cash box; a transfer, a card or Click / Payme reaches the bank account
    return case((method == "cash", "cash"), else_="bank")


def _line(
    source: str,
    m,
    kind,
    place,
    currency,
    amount,
    *,
    category=None,
    party=None,
    party_id=None,
    other_place=None,
    other_currency=None,
    internal=None,
):
    def text(v):
        return cast(null(), String) if v is None else v

    return select(
        literal_column(f"'{source}'", String).label("source"),
        m.id.label("id"),
        m.number.label("number"),
        m.date.label("date"),
        (literal_column(f"'{kind}'", String) if isinstance(kind, str) else kind).label(
            "kind"
        ),
        place.label("place"),
        currency.label("currency"),
        amount.label("amount"),
        text(category).label("category"),
        text(party).label("party"),
        (cast(null(), BigInteger) if party_id is None else party_id).label("party_id"),
        text(other_place).label("other_place"),
        text(other_currency).label("other_currency"),
        m.note.label("note"),
        m.cancelled_at.label("cancelled_at"),
        m.created_at.label("created_at"),
        (false() if internal is None else internal).label("internal"),
    )


def ledger():
    """Every movement of money as one list: customers' payments in, payments to suppliers out,
    expenses out, other money in, and each transfer twice (out of one place, into the other).
    `amount` is signed, cancelled ones are included with `cancelled_at`, and `internal` marks a
    transfer in one currency: the company's money moved, none came or went. What is in the
    cash box and the bank is a sum over this on every read, like debts and stock, so nothing can
    drift out of step."""
    mm = MoneyMove
    return union_all(
        _line(
            "payment",
            Payment,
            "payment",
            _place(Payment.method),
            Payment.currency,
            Payment.amount,
            party=Customer.name,
            party_id=Payment.customer_id,
        ).join(Customer, Customer.id == Payment.customer_id),
        _line(
            "supplier_payment",
            SupplierPayment,
            "payout",
            _place(SupplierPayment.method),
            SupplierPayment.currency,
            -SupplierPayment.amount,
            party=Supplier.name,
            party_id=SupplierPayment.supplier_id,
        ).join(Supplier, Supplier.id == SupplierPayment.supplier_id),
        _line(
            "money_move",
            mm,
            mm.kind,
            mm.place,
            mm.currency,
            case((mm.kind == "income", mm.amount), else_=-mm.amount),
            category=mm.category,
        ).where(mm.kind != "transfer"),
        _line(
            "money_move",
            mm,
            "transfer",
            mm.place,
            mm.currency,
            -mm.amount,
            other_place=mm.to_place,
            other_currency=mm.to_currency,
            internal=mm.currency == mm.to_currency,
        ).where(mm.kind == "transfer"),
        _line(
            "money_move",
            mm,
            "transfer",
            mm.to_place,
            mm.to_currency,
            mm.received,
            other_place=mm.place,
            other_currency=mm.currency,
            internal=mm.currency == mm.to_currency,
        ).where(mm.kind == "transfer"),
    ).subquery("money")


class MoneyManager:
    """The cash box and the bank: what is there, every movement, and the movements that are
    nobody's payment (expenses, other money in, transfers). Row-level security limits every
    query to the company set on the session, so nothing here filters by tenant_id."""

    def __init__(
        self, session: AsyncSession, tenant: Tenant, user_id: int | None = None
    ):
        self.session = session
        self.tenant = tenant
        self.user_id = user_id

    async def balances(self) -> list[dict]:
        """What is in each place, per currency; below zero when money was spent before the
        money that covered it was entered."""
        e = ledger()
        total = func.sum(e.c.amount)
        rows = await self.session.execute(
            select(e.c.place, e.c.currency, total)
            .where(e.c.cancelled_at.is_(None))
            .group_by(e.c.place, e.c.currency)
            .having(total != 0)
            .order_by(e.c.place.desc(), e.c.currency)
        )
        return [{"place": p, "currency": c, "amount": a} for p, c, a in rows]

    async def page(
        self, f: MoneyFilters, limit: int, offset: int
    ) -> tuple[list[dict], int, list[dict]]:
        e = ledger()
        query = select(e)
        for column, value in (
            (e.c.place, f.place),
            (e.c.currency, f.currency),
            (e.c.kind, f.kind),
        ):
            if value:
                query = query.where(column == value)
        if f.date_from:
            query = query.where(e.c.date >= f.date_from)
        if f.date_to:
            query = query.where(e.c.date <= f.date_to)
        found = query.subquery()
        count = await self.session.scalar(select(func.count()).select_from(found))
        counted = found.c.cancelled_at.is_(None)
        if f.place is None:
            # cash carried to the bank is neither money in nor money out of the company
            counted = and_(counted, ~found.c.internal)
        zero = literal_column("0")
        sums = await self.session.execute(
            select(
                found.c.currency,
                func.coalesce(
                    func.sum(found.c.amount).filter(found.c.amount > 0), zero
                ),
                func.coalesce(
                    func.sum(-found.c.amount).filter(found.c.amount < 0), zero
                ),
            )
            .where(counted)
            .group_by(found.c.currency)
            .order_by(found.c.currency)
        )
        newest = f.sort.startswith("-")
        order = [e.c.date, e.c.created_at, e.c.amount]
        rows = await self.session.execute(
            query.order_by(*(c.desc() if newest else c.asc() for c in order))
            .limit(limit)
            .offset(offset)
        )
        return (
            [dict(r) for r in rows.mappings()],
            count or 0,
            [{"currency": c, "incoming": i, "outgoing": o} for c, i, o in sums],
        )

    async def add(self, data: MoveIn) -> MoneyMove:
        move = MoneyMove(
            tenant_id=self.tenant.id,
            date=data.date or clock.today(),
            kind=data.kind,
            place=data.place,
            currency=data.currency,
            amount=data.amount,
            note=data.note,
            created_by=self.user_id,
        )
        if data.kind == "transfer":
            if data.to_place is None:
                raise InvalidField("to_place", "Where to?")
            move.to_place = data.to_place
            move.to_currency = data.to_currency or data.currency
            if move.to_currency == data.currency:
                if data.to_place == data.place:
                    raise InvalidField("to_place", "The same place")
                move.received = data.amount
            elif (
                data.received is None
            ):  # an exchange: what arrived is typed, not computed
                raise InvalidField("received", "What arrived?")
            else:
                move.received = data.received
        else:
            if data.category not in (EXPENSES if data.kind == "expense" else INCOMES):
                raise InvalidField("category", "No such category")
            move.category = data.category
            if data.currency != self.tenant.currency:
                # for the profit report; 422 rather than a guess when none is known
                move.exchange_rate = await RatesManager(
                    self.session, self.tenant
                ).rate_of(data.currency)
        move.number = await StockManager(
            self.session, self.tenant.id, self.user_id
        ).next_number("money")
        self.session.add(move)
        await self.session.flush()
        return move

    async def cancel(self, move_id: int) -> tuple[MoneyMove, bool] | None:
        """The move, and whether this call cancelled it (false when it already was)."""
        move = await self.session.get(MoneyMove, move_id)
        if move is None:
            return None
        if move.cancelled_at is not None:
            return move, False
        move.cancelled_at = datetime.now(UTC)
        await self.session.flush()
        return move, True
