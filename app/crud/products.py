from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import Duplicate, InvalidField
from app.core.text import name_key, search_key
from app.crud.stock import stock_totals
from app.models import PriceList, Product, ProductCategory, ProductPrice
from app.schemas.product import (
    CategoryIn,
    PriceIn,
    PriceListIn,
    PriceListPatch,
    ProductIn,
    ProductPatch,
)

# Default price list name, in the language the owner signed up in.
DEFAULT_PRICE_LIST = {
    "uz": "Asosiy narx",
    "uz-Cyrl": "Асосий нарх",
    "ru": "Основная цена",
}


class ProductManager:
    """Products, their categories, price lists and prices. Row-level security limits every query
    to the company set on the session (CurrentUser does that), so nothing here filters by tenant_id.
    """

    def __init__(self, session: AsyncSession, tenant_id: int):
        self.session = session
        self.tenant_id = tenant_id

    # ---------- products ----------

    async def page(
        self,
        q: str,
        category_id: int | None,
        archived: bool,
        limit: int,
        offset: int,
        sort: str = "name",
    ) -> tuple[list[tuple[Product, Decimal]], int]:
        """Products with their stock in all warehouses together."""
        totals = stock_totals()
        stock = func.coalesce(totals.c.total, 0)
        query = (
            select(Product, stock.label("stock"))
            .outerjoin(totals, totals.c.product_id == Product.id)
            .where(
                Product.archived_at.is_not(None)
                if archived
                else Product.archived_at.is_(None)
            )
        )
        if category_id is not None:
            query = query.where(Product.category_id == category_id)
        # every word must appear: name, article, barcode or МХИК, in any script.
        # Keys hold only a-z, 0-9 and spaces, so no LIKE wildcard can get through.
        for word in search_key(q).split():
            query = query.where(Product.search.contains(word))
        total = await self.session.scalar(
            select(func.count()).select_from(query.subquery())
        )
        column = {"name": Product.name_key, "sku": Product.sku, "stock": stock}[
            sort.lstrip("-")
        ]
        order = column.desc().nulls_last() if sort.startswith("-") else column.asc()
        rows = await self.session.execute(
            query.options(selectinload(Product.prices))
            .order_by(order, Product.id)
            .limit(limit)
            .offset(offset)
        )
        return [(p, s) for p, s in rows], total or 0

    async def get(self, product_id: int) -> Product | None:
        return await self.session.scalar(
            select(Product)
            .where(Product.id == product_id)
            .options(selectinload(Product.prices))
        )

    async def create(self, data: ProductIn) -> Product:
        fields = data.model_dump(exclude={"prices"})
        await self._check_unique(fields)
        await self._check_category(fields["category_id"])
        product = Product(tenant_id=self.tenant_id, prices=[], **fields)
        self._fill_keys(product)
        self.session.add(product)
        await self._set_prices(product, data.prices)
        await self.session.flush()
        return product

    async def update(self, product: Product, data: ProductPatch) -> Product:
        fields = data.model_dump(exclude_unset=True, exclude={"prices"})
        await self._check_unique(fields, exclude=product.id)
        if fields.get("category_id") not in (None, product.category_id):
            await self._check_category(fields["category_id"])
        archived = fields.pop("archived", None)
        if archived is not None and archived != product.archived:
            product.archived_at = datetime.now(UTC) if archived else None
        for field, value in fields.items():
            setattr(product, field, value)
        self._fill_keys(product)
        await self._set_prices(product, data.prices)
        await self.session.flush()
        return product

    async def _set_prices(self, product: Product, prices: list[PriceIn]) -> None:
        if not prices:
            return
        ids = {p.price_list_id for p in prices}
        if len(ids) != len(prices):
            raise InvalidField("prices", "A price list is listed twice")
        found = set(
            await self.session.scalars(
                select(PriceList.id).where(
                    PriceList.id.in_(ids), PriceList.archived_at.is_(None)
                )
            )
        )
        if found != ids:
            raise InvalidField("prices", "No such price list")
        current = {p.price_list_id: p for p in product.prices}
        for p in prices:
            existing = current.get(p.price_list_id)
            if p.amount is None:
                if existing is not None:
                    product.prices.remove(existing)
            elif existing is not None:
                existing.amount = p.amount
            else:
                product.prices.append(
                    ProductPrice(
                        tenant_id=self.tenant_id,
                        price_list_id=p.price_list_id,
                        amount=p.amount,
                    )
                )

    async def _check_unique(self, fields: dict, exclude: int | None = None) -> None:
        # friendlier than the unique indexes, which still guard against races
        for field in ("sku", "barcode"):
            value = fields.get(field)
            if value is None:
                continue
            query = select(Product.id).where(getattr(Product, field) == value)
            if exclude is not None:
                query = query.where(Product.id != exclude)
            existing = await self.session.scalar(query)
            if existing is not None:
                raise Duplicate(field, existing)

    async def _check_category(self, category_id: int | None) -> None:
        if category_id is None:
            return
        found = await self.session.scalar(
            select(ProductCategory.id).where(ProductCategory.id == category_id)
        )
        if found is None:
            raise InvalidField("category_id", "No such category")

    @staticmethod
    def _fill_keys(p: Product) -> None:
        p.name_key = name_key(p.name)
        p.search = search_key(p.name, p.sku, p.barcode, p.mxik)

    # ---------- categories ----------

    async def categories(self) -> list[tuple[ProductCategory, int]]:
        """Each category with how many active products use it, by name."""
        counts = (
            select(Product.category_id, func.count().label("n"))
            .where(Product.archived_at.is_(None))
            .group_by(Product.category_id)
            .subquery()
        )
        rows = await self.session.execute(
            select(ProductCategory, func.coalesce(counts.c.n, 0))
            .outerjoin(counts, counts.c.category_id == ProductCategory.id)
            .order_by(func.lower(ProductCategory.name))
        )
        return [(c, n) for c, n in rows.all()]

    async def get_category(self, category_id: int) -> ProductCategory | None:
        return await self.session.get(ProductCategory, category_id)

    async def create_category(self, data: CategoryIn) -> ProductCategory:
        category = ProductCategory(tenant_id=self.tenant_id, name=data.name)
        self.session.add(category)
        await self.session.flush()  # a taken name: 409 via app/core/errors.py
        return category

    async def rename_category(
        self, category: ProductCategory, data: CategoryIn
    ) -> ProductCategory:
        category.name = data.name
        await self.session.flush()
        return category

    async def delete_category(self, category: ProductCategory) -> None:
        # its products stay, without a category (ON DELETE SET NULL)
        await self.session.delete(category)
        await self.session.flush()

    # ---------- price lists ----------

    async def price_lists(self) -> list[PriceList]:
        rows = await self.session.scalars(
            select(PriceList).order_by(
                PriceList.is_default.desc(), func.lower(PriceList.name)
            )
        )
        return list(rows)

    async def get_price_list(self, price_list_id: int) -> PriceList | None:
        return await self.session.get(PriceList, price_list_id)

    async def create_default_price_list(self, currency: str, lang: str) -> PriceList:
        """Called once, at sign-up."""
        price_list = PriceList(
            tenant_id=self.tenant_id,
            name=DEFAULT_PRICE_LIST.get(lang, DEFAULT_PRICE_LIST["uz"]),
            currency=currency,
            is_default=True,
        )
        self.session.add(price_list)
        await self.session.flush()
        return price_list

    async def create_price_list(self, data: PriceListIn) -> PriceList:
        price_list = PriceList(
            tenant_id=self.tenant_id, name=data.name, currency=data.currency
        )
        self.session.add(price_list)
        await self.session.flush()  # a taken name: 409
        return price_list

    async def update_price_list(
        self, price_list: PriceList, data: PriceListPatch
    ) -> PriceList:
        fields = data.model_dump(exclude_unset=True)
        if "name" in fields:
            price_list.name = fields["name"]
        archived = fields.get("archived")
        if fields.get("is_default") and not price_list.is_default:
            if price_list.archived and archived is not False:
                raise InvalidField(
                    "is_default", "An archived list can't be the default"
                )
            old = await self.session.scalar(
                select(PriceList).where(PriceList.is_default)
            )
            if old is not None:
                old.is_default = False
                await self.session.flush()  # free the one-default index first
            price_list.is_default = True
        if archived is not None and archived != price_list.archived:
            if archived and price_list.is_default:
                raise InvalidField("archived", "The default list can't be archived")
            price_list.archived_at = datetime.now(UTC) if archived else None
        await self.session.flush()
        return price_list
