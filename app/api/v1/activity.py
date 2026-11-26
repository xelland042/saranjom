from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.crud.activity import ActivityLog
from app.models import ENTITIES, Customer
from app.schemas.activity import ActivityOut, NoteIn

router = APIRouter(tags=["History"])

# what one needs to see each kind of entry ("money": opening debts on a customer's record)
SEES = {
    "order": "orders.read",
    "payment": "money.read",
    "money": "money.read",
    "task": "tasks",
    "product": "products.read",
    "stock_document": "stock.read",
    "return": "orders.read",
    "supplier": "stock.read",
    "supplier_payment": "money.read",
    "money_move": "money.read",
}


def _log(session, current) -> ActivityLog:
    user, tenant = current
    return ActivityLog(session, tenant.id, user.id)


@router.get("/activity", response_model=list[ActivityOut])
async def activity(
    session: SessionDep,
    current: CurrentUser,
    customer_id: int | None = None,
    entity: Annotated[str | None, Query(pattern=f"^({'|'.join(ENTITIES)})$")] = None,
    entity_id: int | None = None,
    before: int | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    """A customer's timeline (their record, orders, payments, tasks and notes), or one record's
    history (entity and entity_id); newest first, `before` an id to page back."""
    if (entity is None) != (entity_id is None):
        raise HTTPException(422, "entity and entity_id go together")
    return await _log(session, current).feed(
        customer_id=customer_id,
        entity=entity,
        entity_id=entity_id,
        before=before,
        limit=limit,
        hidden=frozenset(e for e, need in SEES.items() if not allowed(current, need)),
    )


@router.post(
    "/customers/{customer_id}/notes",
    response_model=ActivityOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_note(
    customer_id: int, data: NoteIn, session: SessionDep, current: CurrentUser
):
    if await session.get(Customer, customer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return await _log(session, current).note(customer_id, data.text)


@router.delete("/activity/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(activity_id: int, session: SessionDep, current: CurrentUser):
    """Only one's own notes; the rest of the history can't be deleted."""
    if not await _log(session, current).delete_note(activity_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
