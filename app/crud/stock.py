from collections import defaultdict
import datetime as dt
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import (
    BigInteger,
    Select,
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
from sqlalchemy.orm import selectinload

from app.core.clock import TASHKENT
from app.core.errors import InvalidField
from app.core.text import search_key
from app.models import (
    Customer,
    DocumentCounter,
    OrderLine,
    SalesOrder,
    Product,
    ReturnLine,
    SalesReturn,
    StockDocument,
    StockLine,
    Supplier,
    Warehouse,
)
from app.schemas.stock import DocumentIn, LineIn, WarehouseIn, WarehousePatch

DEFAULT_WAREHOUSE = {
    "uz": "Asosiy ombor",
    "uz-Cyrl": "Асосий омбор",
    "ru": "Основной склад",
}
ZERO = Decimal("0.000")
DOC_LINES = 500  # a stock document's limit (DocumentIn)
CENT = Decimal("0.01")


def movements() -> Select:
    """Every posted line as (product_id, warehouse_id, signed quantity): receipts and returns
    from customers add, write-offs and confirmed sales take away, transfers take from one
    warehouse and add to the other. Cancelled documents, orders and returns don't count. Balances are sums of this.
    shortcut: summed on every read; add a balance table kept by the same transaction if it gets slow
    (thousands of documents a month)."""
    posted = StockDocument.cancelled_at.is_(None)
    joined = select(StockLine).join(
        StockDocument, StockDocument.id == StockLine.document_id
    )
    source = joined.with_only_columns(
        StockLine.product_id,
        StockDocument.warehouse_id.label("warehouse_id"),
        case(
            (StockDocument.kind == "receipt", StockLine.quantity),
            else_=-StockLine.quantity,
        ).label("quantity"),
    ).where(posted)
    target = (
        joined.with_only_columns(
            StockLine.product_id,
            StockDocument.to_warehouse_id.label("warehouse_id"),
            StockLine.quantity.label("quantity"),
        )
        .where(posted)
        .where(StockDocument.kind == "transfer")
    )
    # confirmed sales take their goods out of the order's warehouse
    sold = (
        select(
            OrderLine.product_id,
            SalesOrder.warehouse_id.label("warehouse_id"),
            (-OrderLine.quantity).label("quantity"),
        )
        .join(SalesOrder, SalesOrder.id == OrderLine.order_id)
        .where(SalesOrder.status == "confirmed")
    )
    # returns bring them back into the warehouse the return names
    back = (
        select(
            ReturnLine.product_id,
            SalesReturn.warehouse_id.label("warehouse_id"),
            ReturnLine.quantity.label("quantity"),
        )
        .join(SalesReturn, SalesReturn.id == ReturnLine.return_id)
        .where(SalesReturn.cancelled_at.is_(None))
    )
    return union_all(source, target, sold, back)


def stock_totals():
    """(product_id, total) over all warehouses."""
    m = movements().subquery()
    return (
        select(m.c.product_id, func.sum(m.c.quantity).label("total"))
        .group_by(m.c.product_id)
        .subquery("stock_totals")
    )


class StockManager:
    """Warehouses, stock documents and balances. Row-level security limits every query to the
    company set on the session (CurrentUser does that), so nothing here filters by tenant_id.
    """

    def __init__(
        self, session: AsyncSession, tenant_id: int, user_id: int | None = None
    ):
        self.session = session
        self.tenant_id = tenant_id
        self.user_id = user_id

    # ---------- warehouses ----------

    async def warehouses(self) -> list[Warehouse]:
        rows = await self.session.scalars(
            select(Warehouse).order_by(
                Warehouse.is_default.desc(), func.lower(Warehouse.name)
            )
        )
        return list(rows)

    async def get_warehouse(self, warehouse_id: int) -> Warehouse | None:
        return await self.session.get(Warehouse, warehouse_id)

    async def create_default_warehouse(self, lang: str) -> Warehouse:
        """Called once, at sign-up."""
        w = Warehouse(
            tenant_id=self.tenant_id,
            name=DEFAULT_WAREHOUSE.get(lang, DEFAULT_WAREHOUSE["uz"]),
            is_default=True,
        )
        self.session.add(w)
        await self.session.flush()
        return w

    async def create_warehouse(self, data: WarehouseIn) -> Warehouse:
        w = Warehouse(tenant_id=self.tenant_id, name=data.name)
        self.session.add(w)
        await self.session.flush()  # a taken name: 409
        return w

    async def update_warehouse(self, w: Warehouse, data: WarehousePatch) -> Warehouse:
        fields = data.model_dump(exclude_unset=True)
        if "name" in fields:
            w.name = fields["name"]
        archived = fields.get("archived")
        if fields.get("is_default") and not w.is_default:
            if w.archived and archived is not False:
                raise InvalidField(
                    "is_default", "An archived warehouse can't be the default"
                )
            old = await self.session.scalar(
                select(Warehouse).where(Warehouse.is_default)
            )
            if old is not None:
                old.is_default = False
                await self.session.flush()  # free the one-default index first
            w.is_default = True
        if archived is not None and archived != w.archived:
            if archived:
                if w.is_default:
                    raise InvalidField(
                        "archived", "The default warehouse can't be archived"
                    )
                # goods would vanish from every list: move or write them off first
                b = self._balances(warehouse_id=w.id).subquery()
                left = await self.session.scalar(
                    select(func.count()).select_from(b).where(b.c.quantity != 0)
                )
                if left:
                    raise InvalidField("archived", "The warehouse still has stock")
            w.archived_at = datetime.now(UTC) if archived else None
        await self.session.flush()
        return w

    # ---------- balances ----------

    def _balances(
        self, product_ids: list[int] | None = None, warehouse_id: int | None = None
    ) -> Select:
        m = movements().subquery()
        query = select(
            m.c.product_id,
            m.c.warehouse_id,
            func.sum(m.c.quantity).label("quantity"),
        ).group_by(m.c.product_id, m.c.warehouse_id)
        if product_ids is not None:
            query = query.where(m.c.product_id.in_(product_ids))
        if warehouse_id is not None:
            query = query.where(m.c.warehouse_id == warehouse_id)
        return query

    async def balances(
        self, product_ids: list[int], warehouse_id: int | None = None
    ) -> dict[int, dict[int, Decimal]]:
        """product id -> warehouse id -> quantity, leaving out zeros."""
        out: dict[int, dict[int, Decimal]] = defaultdict(dict)
        if not product_ids:
            return out
        for p, w, q in (
            await self.session.execute(self._balances(product_ids, warehouse_id))
        ).all():
            if q != 0:
                out[p][w] = q
        return out

    async def stock_page(
        self,
        q: str,
        warehouse_id: int | None,
        show: str,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        """Active products with their stock. show: 'all', 'positive' (in stock) or 'negative'
        (sold or written off beyond what was entered: needs fixing)."""
        b = self._balances(warehouse_id=warehouse_id).subquery()
        totals = (
            select(b.c.product_id, func.sum(b.c.quantity).label("total"))
            .group_by(b.c.product_id)
            .subquery()
        )
        total = func.coalesce(totals.c.total, ZERO)
        query = (
            select(Product, total.label("total"))
            .outerjoin(totals, totals.c.product_id == Product.id)
            .where(Product.archived_at.is_(None))
        )
        for word in search_key(q).split():
            query = query.where(Product.search.contains(word))
        if show == "positive":
            query = query.where(total > 0)
        elif show == "negative":
            query = query.where(total < 0)
        elif show == "low":
            query = query.where(total < Product.min_stock)
        count = await self.session.scalar(
            select(func.count()).select_from(query.subquery())
        )
        rows = (
            await self.session.execute(
                query.order_by(Product.name_key, Product.id).limit(limit).offset(offset)
            )
        ).all()
        per = await self.balances([p.id for p, _ in rows], warehouse_id)
        items = [
            {
                "product_id": p.id,
                "name": p.name,
                "sku": p.sku,
                "unit": p.unit,
                "quantities": per.get(p.id, {}),
                "total": t,
                "min_stock": p.min_stock,
            }
            for p, t in rows
        ]
        return items, count or 0

    async def product_movements(self, product_id: int, limit: int) -> list[dict]:
        """A product's posted receipts, write-offs, transfers, sales and returns, newest first."""
        posted = StockDocument.cancelled_at.is_(None)
        docs = (
            select(
                StockDocument.date,
                StockDocument.kind,
                StockDocument.id,
                StockDocument.number,
                StockDocument.warehouse_id,
                StockDocument.to_warehouse_id,
                StockLine.quantity,
                literal(None, String).label("customer_name"),
                StockDocument.created_at.label("at"),
            )
            .join(StockDocument, StockDocument.id == StockLine.document_id)
            .where(StockLine.product_id == product_id, posted)
        )
        sales = (
            select(
                SalesOrder.date,
                literal("sale", String),
                SalesOrder.id,
                SalesOrder.number,
                SalesOrder.warehouse_id,
                literal(None, BigInteger),
                OrderLine.quantity,
                Customer.name,
                SalesOrder.confirmed_at,
            )
            .join(SalesOrder, SalesOrder.id == OrderLine.order_id)
            .join(Customer, Customer.id == SalesOrder.customer_id)
            .where(OrderLine.product_id == product_id, SalesOrder.status == "confirmed")
        )
        returns = (
            select(
                SalesReturn.date,
                literal("return", String),
                SalesReturn.id,
                SalesReturn.number,
                SalesReturn.warehouse_id,
                literal(None, BigInteger),
                ReturnLine.quantity,
                Customer.name,
                SalesReturn.created_at,
            )
            .join(SalesReturn, SalesReturn.id == ReturnLine.return_id)
            .join(Customer, Customer.id == SalesReturn.customer_id)
            .where(
                ReturnLine.product_id == product_id, SalesReturn.cancelled_at.is_(None)
            )
        )
        both = union_all(docs, sales, returns).subquery()
        rows = await self.session.execute(
            # the same day: in the order they happened (a sale counts when it's confirmed)
            select(both)
            .order_by(both.c.date.desc(), both.c.at.desc())
            .limit(limit)
        )
        return [dict(r._mapping) for r in rows]

    # ---------- documents ----------

    async def documents(
        self,
        kind: str | None,
        limit: int,
        offset: int,
        supplier_id: int | None = None,
    ) -> tuple[list[dict], int]:
        lines = (
            select(StockLine.document_id, func.count().label("n"))
            .group_by(StockLine.document_id)
            .subquery()
        )
        query = (
            select(StockDocument, func.coalesce(lines.c.n, 0), Supplier.name)
            .outerjoin(lines, lines.c.document_id == StockDocument.id)
            .outerjoin(Supplier, Supplier.id == StockDocument.supplier_id)
        )
        if kind:
            query = query.where(StockDocument.kind == kind)
        if supplier_id:
            query = query.where(StockDocument.supplier_id == supplier_id)
        count = await self.session.scalar(
            select(func.count()).select_from(query.subquery())
        )
        rows = (
            await self.session.execute(
                query.order_by(StockDocument.date.desc(), StockDocument.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        items = [
            {
                "id": d.id,
                "kind": d.kind,
                "number": d.number,
                "date": d.date,
                "warehouse_id": d.warehouse_id,
                "to_warehouse_id": d.to_warehouse_id,
                "currency": d.currency,
                "supplier_id": d.supplier_id,
                "supplier_name": supplier,
                "total": d.total,
                "cancelled": d.cancelled,
                "lines": n,
            }
            for d, n, supplier in rows
        ]
        return items, count or 0

    async def get_document(self, document_id: int) -> StockDocument | None:
        return await self.session.scalar(
            select(StockDocument)
            .where(StockDocument.id == document_id)
            .options(selectinload(StockDocument.lines))
        )

    async def create_document(
        self, data: DocumentIn, exchange_rate: Decimal | None = None
    ) -> StockDocument:
        """`exchange_rate`: for a purchase in a foreign currency, the rate to save on it."""
        await self.check_warehouse("warehouse_id", data.warehouse_id)
        if data.kind == "transfer":
            if (
                data.to_warehouse_id is None
                or data.to_warehouse_id == data.warehouse_id
            ):
                raise InvalidField("to_warehouse_id", "Choose another warehouse")
            await self.check_warehouse("to_warehouse_id", data.to_warehouse_id)
        elif data.to_warehouse_id is not None:
            raise InvalidField("to_warehouse_id", "Only transfers have a target")
        has_prices = any(line.price is not None for line in data.lines)
        if has_prices and data.kind != "receipt":
            raise InvalidField("lines", "Only receipts have prices")
        if has_prices and data.currency is None:
            raise InvalidField("currency", "Prices need a currency")
        if data.supplier_id is not None:
            if data.kind != "receipt":
                raise InvalidField("supplier_id", "Only receipts have a supplier")
            # what we owe for it is the sum of its lines, so none may be left without a price
            if any(line.price is None for line in data.lines):
                raise InvalidField("lines", "A purchase needs a price on every line")
            supplier = await self.session.get(Supplier, data.supplier_id)
            if supplier is None or supplier.archived_at is not None:
                raise InvalidField("supplier_id", "No such supplier")
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

        doc = StockDocument(
            tenant_id=self.tenant_id,
            kind=data.kind,
            number=await self.next_number(data.kind),
            date=data.date or datetime.now(TASHKENT).date(),
            warehouse_id=data.warehouse_id,
            to_warehouse_id=data.to_warehouse_id,
            currency=data.currency if has_prices else None,
            supplier_id=data.supplier_id,
            # each line rounded by itself, like an order's lines, so the lines add up to the total
            total=(
                sum(
                    (
                        (line.quantity * line.price).quantize(
                            CENT, rounding=ROUND_HALF_UP
                        )
                        for line in data.lines
                        if line.price is not None
                    ),
                    Decimal("0.00"),
                )
                if has_prices
                else None
            ),
            exchange_rate=exchange_rate if data.supplier_id is not None else None,
            note=data.note,
            created_by=self.user_id,
            lines=[
                StockLine(
                    tenant_id=self.tenant_id,
                    product_id=line.product_id,
                    quantity=line.quantity,
                    price=line.price,
                )
                for line in data.lines
            ],
        )
        self.session.add(doc)
        await self.session.flush()
        return doc

    async def set_stock(
        self,
        warehouse_id: int,
        wanted: dict[int, Decimal],
        date: dt.date | None = None,
        note: str | None = None,
    ) -> list[StockDocument]:
        """Brings these products to these quantities in a warehouse (an Excel import, a stock
        count): a receipt for what's missing and a write-off for what's over, never an edit.
        """
        have = await self.balances(list(wanted), warehouse_id)
        diffs = {
            pid: q - have.get(pid, {}).get(warehouse_id, Decimal(0))
            for pid, q in wanted.items()
        }
        docs = []
        for kind, sign in (("receipt", 1), ("write_off", -1)):
            lines = [
                LineIn(product_id=pid, quantity=d * sign)
                for pid, d in diffs.items()
                if d * sign > 0
            ]
            for start in range(0, len(lines), DOC_LINES):
                docs.append(
                    await self.create_document(
                        DocumentIn(
                            kind=kind,
                            date=date,
                            warehouse_id=warehouse_id,
                            note=note,
                            lines=lines[start : start + DOC_LINES],
                        )
                    )
                )
        return docs

    async def moved_since(
        self, warehouse_id: int, expected: dict[int, Decimal]
    ) -> dict[int, Decimal]:
        """Of these products, those whose stock is no longer what the person saw: product id ->
        what it is now. A count typed against old numbers would post the wrong differences.
        """
        have = await self.balances(list(expected), warehouse_id)
        now = {pid: have.get(pid, {}).get(warehouse_id, ZERO) for pid in expected}
        return {pid: q for pid, q in now.items() if q != expected[pid]}

    async def cancel_document(self, doc: StockDocument) -> StockDocument:
        if not doc.cancelled:
            doc.cancelled_at = datetime.now(UTC)
            await self.session.flush()
        return doc

    async def negatives(self, doc: StockDocument) -> list[dict]:
        """The document's products that are now below zero in the warehouses it touched."""
        return await self.negatives_for(
            [line.product_id for line in doc.lines],
            {doc.warehouse_id, doc.to_warehouse_id} - {None},
        )

    async def negatives_for(
        self, product_ids: list[int], places: set[int]
    ) -> list[dict]:
        """Of these products, those now below zero in these warehouses."""
        ids = list(set(product_ids))
        per = await self.balances(ids)
        names = dict(
            (
                await self.session.execute(
                    select(Product.id, Product.name).where(Product.id.in_(ids))
                )
            ).all()
        )
        return [
            {
                "product_id": p,
                "product_name": names[p],
                "warehouse_id": w,
                "quantity": q,
            }
            for p in ids
            for w, q in per.get(p, {}).items()
            if w in places and q < 0
        ]

    async def products_of(self, doc: StockDocument) -> dict[int, Product]:
        ids = {line.product_id for line in doc.lines}
        rows = await self.session.scalars(select(Product).where(Product.id.in_(ids)))
        return {p.id: p for p in rows}

    async def next_number(self, kind: str) -> int:
        stmt = insert(DocumentCounter).values(
            tenant_id=self.tenant_id, kind=kind, last=1
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["tenant_id", "kind"],
            set_={"last": DocumentCounter.last + 1},
        ).returning(DocumentCounter.last)
        return (await self.session.execute(stmt)).scalar_one()

    async def check_warehouse(self, field: str, warehouse_id: int) -> None:
        found = await self.session.scalar(
            select(Warehouse.id).where(
                and_(Warehouse.id == warehouse_id, Warehouse.archived_at.is_(None))
            )
        )
        if found is None:
            raise InvalidField(field, "No such warehouse")
