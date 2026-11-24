from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Activity, User


def _plain(v):
    """A value as JSON keeps it: money and quantities as strings, like the API sends them."""
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (date, datetime, time)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    return v


def snapshot(obj, fields) -> dict:
    return {f: getattr(obj, f) for f in fields}


def changes(before: dict, obj) -> dict:
    """{field: [old, new]} for the fields of `before` that `obj` now has differently."""
    return {
        f: [old, getattr(obj, f)] for f, old in before.items() if getattr(obj, f) != old
    }


class ActivityLog:
    """Writes and reads the history. Row-level security keeps it per company."""

    def __init__(self, session: AsyncSession, tenant_id: int, user_id: int | None):
        self.session = session
        self.tenant_id = tenant_id
        self.user_id = user_id

    def add(
        self,
        entity: str,
        entity_id: int,
        action: str,
        customer_id: int | None = None,
        text: str | None = None,
        **data,
    ) -> Activity:
        row = Activity(
            tenant_id=self.tenant_id,
            entity=entity,
            entity_id=entity_id,
            action=action,
            customer_id=customer_id,
            user_id=self.user_id,
            text=text,
            data=_plain(data) or None,
        )
        self.session.add(row)
        return row

    async def note(self, customer_id: int, text: str) -> dict:
        row = self.add("customer", customer_id, "note", customer_id, text)
        await self.session.flush()
        return (await self.feed(ids=[row.id]))[0]

    async def delete_note(self, activity_id: int) -> bool:
        """Only a note, and only by the person who wrote it; the rest is the record's history."""
        row = await self.session.scalar(
            select(Activity).where(
                Activity.id == activity_id,
                Activity.action == "note",
                Activity.user_id == self.user_id,
            )
        )
        if row is None:
            return False
        await self.session.delete(row)
        await self.session.flush()
        return True

    async def feed(
        self,
        customer_id: int | None = None,
        entity: str | None = None,
        entity_id: int | None = None,
        before: int | None = None,
        limit: int = 50,
        ids: list[int] | None = None,
        hidden: frozenset[str] = frozenset(),
    ) -> list[dict]:
        """Newest first; `before` (an id) pages back. `hidden`: entities the reader may not see
        (and "money" for opening debts), left out in the query so paging stays whole."""
        query = select(Activity, User.name).outerjoin(User, User.id == Activity.user_id)
        if hidden:
            query = query.where(Activity.entity.not_in(hidden))
        if "money" in hidden:
            query = query.where(
                Activity.action.not_in(("opening_set", "opening_deleted"))
            )
        if ids is not None:
            query = query.where(Activity.id.in_(ids))
        if customer_id is not None:
            query = query.where(Activity.customer_id == customer_id)
        if entity is not None:
            mine = and_(Activity.entity == entity, Activity.entity_id == entity_id)
            if entity == "order":
                # an order's history includes its returns
                mine = or_(
                    mine,
                    and_(
                        Activity.entity == "return",
                        Activity.data["order_id"].as_integer() == entity_id,
                    ),
                )
            query = query.where(mine)
        if before is not None:
            query = query.where(Activity.id < before)
        rows = await self.session.execute(
            query.order_by(Activity.id.desc()).limit(limit)
        )
        return [
            {
                "id": a.id,
                "entity": a.entity,
                "entity_id": a.entity_id,
                "action": a.action,
                "customer_id": a.customer_id,
                "user_id": a.user_id,
                "user_name": name,
                "text": a.text,
                "data": a.data or {},
                "created_at": a.created_at,
                "mine": a.user_id is not None and a.user_id == self.user_id,
            }
            for a, name in rows
        ]
