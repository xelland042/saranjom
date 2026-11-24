from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import Duplicate, InvalidField
from app.core.text import name_key, search_key
from app.models import Customer, CustomerContact, PriceList, SalesOrder
from app.schemas.customer import (
    ContactIn,
    ContactPatch,
    CustomerIn,
    CustomerPatch,
)

# how alike two names must be (pg_trgm similarity, 0 to 1) to warn about a duplicate
SIMILAR = 0.45


class CustomerManager:
    """Customers and their contacts. Row-level security limits every query to the company
    set on the session (CurrentUser does that), so nothing here filters by tenant_id.
    """

    def __init__(self, session: AsyncSession, tenant_id: int):
        self.session = session
        self.tenant_id = tenant_id

    async def page(
        self, q: str, archived: bool, sort: str, limit: int, offset: int
    ) -> tuple[list[tuple[Customer, date | None]], int]:
        """Customers with the date of their last confirmed order."""
        last = (
            select(
                SalesOrder.customer_id, func.max(SalesOrder.date).label("last_order")
            )
            .where(SalesOrder.status == "confirmed")
            .group_by(SalesOrder.customer_id)
            .subquery()
        )
        query = (
            select(Customer, last.c.last_order)
            .outerjoin(last, last.c.customer_id == Customer.id)
            .where(
                Customer.archived_at.is_not(None)
                if archived
                else Customer.archived_at.is_(None)
            )
        )
        # every word must appear somewhere: name, ИНН, phone or address, in any script.
        # Keys hold only a-z, 0-9 and spaces, so no LIKE wildcard can get through.
        for word in search_key(q).split():
            query = query.where(Customer.search.contains(word))
        total = await self.session.scalar(
            select(func.count()).select_from(query.subquery())
        )
        column = {
            "name": Customer.name_key,
            "created": Customer.created_at,
            "last_order": last.c.last_order,
        }[sort.lstrip("-")]
        order = column.desc().nulls_last() if sort.startswith("-") else column.asc()
        rows = await self.session.execute(
            query.order_by(order, Customer.id).limit(limit).offset(offset)
        )
        return [(c, d) for c, d in rows], total or 0

    async def similar(self, name: str, exclude: int | None = None) -> list[Customer]:
        key = name_key(name)
        if not key:
            return []
        score = func.similarity(Customer.name_key, key)
        query = select(Customer).where(score >= SIMILAR)
        if exclude is not None:
            query = query.where(Customer.id != exclude)
        return list(await self.session.scalars(query.order_by(score.desc()).limit(5)))

    async def get(self, customer_id: int) -> Customer | None:
        return await self.session.scalar(
            select(Customer)
            .where(Customer.id == customer_id)
            .options(selectinload(Customer.contacts))
        )

    async def create(self, data: CustomerIn) -> Customer:
        await self._check_inn(data.inn)
        await self._check_price_list(data.price_list_id)
        customer = Customer(tenant_id=self.tenant_id, contacts=[], **data.model_dump())
        self._fill_keys(customer)
        self.session.add(customer)
        await self.session.flush()
        return customer

    async def update(self, customer: Customer, data: CustomerPatch) -> Customer:
        fields = data.model_dump(exclude_unset=True)
        if "inn" in fields and fields["inn"] != customer.inn:
            await self._check_inn(fields["inn"], exclude=customer.id)
        if fields.get("price_list_id") not in (None, customer.price_list_id):
            await self._check_price_list(fields["price_list_id"])
        archived = fields.pop("archived", None)
        if archived is not None and archived != customer.archived:
            customer.archived_at = datetime.now(UTC) if archived else None
        for field, value in fields.items():
            setattr(customer, field, value)
        self._fill_keys(customer)
        await self.session.flush()
        return customer

    async def add_contact(self, customer: Customer, data: ContactIn) -> CustomerContact:
        contact = CustomerContact(tenant_id=self.tenant_id, **data.model_dump())
        customer.contacts.append(contact)
        await self.session.flush()
        return contact

    async def update_contact(
        self, contact: CustomerContact, data: ContactPatch
    ) -> CustomerContact:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(contact, field, value)
        await self.session.flush()
        return contact

    async def delete_contact(
        self, customer: Customer, contact: CustomerContact
    ) -> None:
        customer.contacts.remove(contact)
        await self.session.flush()

    async def _check_inn(self, inn: str | None, exclude: int | None = None) -> None:
        # a friendlier answer than the unique index, which still guards against races
        if inn is None:
            return
        query = select(Customer.id).where(Customer.inn == inn)
        if exclude is not None:
            query = query.where(Customer.id != exclude)
        existing = await self.session.scalar(query)
        if existing is not None:
            raise Duplicate("inn", existing)

    async def _check_price_list(self, price_list_id: int | None) -> None:
        # the foreign key would also refuse another company's list, but as a 500
        if price_list_id is None:
            return
        found = await self.session.scalar(
            select(PriceList.id).where(
                PriceList.id == price_list_id, PriceList.archived_at.is_(None)
            )
        )
        if found is None:
            raise InvalidField("price_list_id", "No such price list")

    @staticmethod
    def _fill_keys(c: Customer) -> None:
        c.name_key = name_key(c.name)
        c.search = search_key(c.name, c.inn, c.phone and c.phone[1:], c.address)
