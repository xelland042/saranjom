from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import Duplicate, InvalidField
from app.core.text import search_key
from app.crud.rates import RatesManager
from app.crud.stock import StockManager
from app.models import StockDocument, Supplier, SupplierPayment, Tenant
from app.schemas.supplier import (
    SupplierFilters,
    SupplierIn,
    SupplierPatch,
    SupplierPaymentFilters,
    SupplierPaymentIn,
)

PAYMENT_SORT = {
    "date": SupplierPayment.date,
    "number": SupplierPayment.number,
    "amount": SupplierPayment.amount,
}


def owed():
    """What we owe each supplier, per currency: (supplier_id, currency, owed), zero ones left out.
    Receipts from a supplier (purchases) add their total; payments to them take away; cancelled
    ones don't count. Negative when we paid ahead. Summed on every read, like customers' debts,
    so nothing can drift out of step.
    shortcut: no due dates and no opening amounts yet; add them when a firm with running
    supplier debts starts using this."""
    bought = select(
        StockDocument.supplier_id, StockDocument.currency, StockDocument.total
    ).where(
        StockDocument.supplier_id.is_not(None), StockDocument.cancelled_at.is_(None)
    )
    paid = select(
        SupplierPayment.supplier_id, SupplierPayment.currency, -SupplierPayment.amount
    ).where(SupplierPayment.cancelled_at.is_(None))
    e = union_all(bought, paid).subquery("payable")
    total = func.sum(e.c.total)
    return (
        select(e.c.supplier_id, e.c.currency, total.label("owed"))
        .group_by(e.c.supplier_id, e.c.currency)
        .having(total != 0)
        .subquery("owed")
    )


class SupplierManager:
    """Suppliers, what we owe them and what we paid them. Row-level security limits every query
    to the company set on the session, so nothing here filters by tenant_id."""

    def __init__(
        self, session: AsyncSession, tenant: Tenant, user_id: int | None = None
    ):
        self.session = session
        self.tenant = tenant
        self.user_id = user_id

    # ---------- suppliers ----------

    async def page(
        self, f: SupplierFilters, limit: int, offset: int
    ) -> tuple[list[Supplier], int]:
        query = select(Supplier).where(
            Supplier.archived_at.is_not(None)
            if f.archived
            else Supplier.archived_at.is_(None)
        )
        # every word must appear somewhere: name, ИНН, phone or address, in any script
        for word in search_key(f.q).split():
            query = query.where(Supplier.search.contains(word))
        if f.owed:
            o = owed()
            query = query.where(
                Supplier.id.in_(select(o.c.supplier_id).where(o.c.owed > 0))
            )
        total = await self.session.scalar(
            select(func.count()).select_from(query.subquery())
        )
        column = {"name": func.lower(Supplier.name), "created": Supplier.created_at}[
            f.sort.lstrip("-")
        ]
        order = column.desc() if f.sort.startswith("-") else column.asc()
        rows = await self.session.scalars(
            query.order_by(order, Supplier.id).limit(limit).offset(offset)
        )
        return list(rows), total or 0

    async def get(self, supplier_id: int) -> Supplier | None:
        return await self.session.get(Supplier, supplier_id)

    async def create(self, data: SupplierIn) -> Supplier:
        await self._check_inn(data.inn)
        supplier = Supplier(tenant_id=self.tenant.id, **data.model_dump())
        self._fill_keys(supplier)
        self.session.add(supplier)
        await self.session.flush()
        return supplier

    async def update(self, supplier: Supplier, data: SupplierPatch) -> Supplier:
        fields = data.model_dump(exclude_unset=True)
        if "inn" in fields and fields["inn"] != supplier.inn:
            await self._check_inn(fields["inn"], exclude=supplier.id)
        archived = fields.pop("archived", None)
        if archived is not None and archived != supplier.archived:
            supplier.archived_at = datetime.now(UTC) if archived else None
        for field, value in fields.items():
            setattr(supplier, field, value)
        self._fill_keys(supplier)
        await self.session.flush()
        return supplier

    async def _check_inn(self, inn: str | None, exclude: int | None = None) -> None:
        # a friendlier answer than the unique index, which still guards against races
        if inn is None:
            return
        query = select(Supplier.id).where(Supplier.inn == inn)
        if exclude is not None:
            query = query.where(Supplier.id != exclude)
        existing = await self.session.scalar(query)
        if existing is not None:
            raise Duplicate("inn", existing)

    @staticmethod
    def _fill_keys(s: Supplier) -> None:
        s.search = search_key(s.name, s.inn, s.phone and s.phone[1:], s.address)

    # ---------- what we owe ----------

    async def balances_of(self, supplier_ids: list[int]) -> dict[int, list[dict]]:
        if not supplier_ids:
            return {}
        o = owed()
        rows = await self.session.execute(
            select(o).where(o.c.supplier_id.in_(supplier_ids)).order_by(o.c.currency)
        )
        out: dict[int, list[dict]] = {}
        for supplier_id, currency, amount in rows:
            out.setdefault(supplier_id, []).append(
                {"currency": currency, "owed": amount}
            )
        return out

    async def totals(self) -> list[dict]:
        """What we owe all suppliers together, per currency (money paid ahead isn't netted off:
        one supplier's advance doesn't pay another's bill)."""
        o = owed()
        rows = await self.session.execute(
            select(o.c.currency, func.sum(o.c.owed))
            .where(o.c.owed > 0)
            .group_by(o.c.currency)
            .order_by(o.c.currency)
        )
        return [{"currency": c, "owed": a} for c, a in rows]

    # ---------- payments ----------

    def _payments(self):
        return select(SupplierPayment, Supplier.name).join(
            Supplier, Supplier.id == SupplierPayment.supplier_id
        )

    @staticmethod
    def _row(payment: SupplierPayment, name: str) -> dict:
        return {
            **{
                c.key: getattr(payment, c.key)
                for c in SupplierPayment.__table__.columns
            },
            "supplier_name": name,
        }

    async def payments(
        self, f: SupplierPaymentFilters, limit: int, offset: int
    ) -> tuple[list[dict], int, list[dict]]:
        query = self._payments()
        if f.supplier_id:
            query = query.where(SupplierPayment.supplier_id == f.supplier_id)
        if f.date_from:
            query = query.where(SupplierPayment.date >= f.date_from)
        if f.date_to:
            query = query.where(SupplierPayment.date <= f.date_to)
        for word in search_key(f.q).split():
            query = query.where(Supplier.search.contains(word))
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
            query.order_by(direction, SupplierPayment.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return (
            [self._row(p, n) for p, n in rows],
            count or 0,
            [{"currency": c, "amount": a} for c, a in sums],
        )

    async def payment(self, payment_id: int) -> dict | None:
        row = (
            await self.session.execute(
                self._payments().where(SupplierPayment.id == payment_id)
            )
        ).first()
        return self._row(*row) if row else None

    async def add_payment(self, data: SupplierPaymentIn) -> int:
        # an archived supplier may still be paid what we owe them
        supplier = await self.get(data.supplier_id)
        if supplier is None:
            raise InvalidField("supplier_id", "No such supplier")
        payment = SupplierPayment(
            tenant_id=self.tenant.id,
            number=await StockManager(
                self.session, self.tenant.id, self.user_id
            ).next_number("payout"),
            date=data.date or clock.today(),
            supplier_id=supplier.id,
            amount=data.amount,
            currency=data.currency,
            exchange_rate=await self.rate(data.currency),
            method=data.method,
            note=data.note,
            created_by=self.user_id,
        )
        self.session.add(payment)
        await self.session.flush()
        return payment.id

    async def cancel_payment(self, payment_id: int) -> bool:
        payment = await self.session.get(SupplierPayment, payment_id)
        if payment is None:
            return False
        if payment.cancelled_at is None:
            payment.cancelled_at = datetime.now(UTC)
            await self.session.flush()
        return True

    async def rate(self, currency: str) -> Decimal | None:
        """The rate to save on a purchase or a payment: none in the company's own currency,
        422 rather than a guess when a foreign one has no rate."""
        if currency == self.tenant.currency:
            return None
        return await RatesManager(self.session, self.tenant).rate_of(currency)
