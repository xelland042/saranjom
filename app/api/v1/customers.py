from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.crud.activity import ActivityLog, changes, snapshot
from app.core.xlsx import MAX_ROWS, xlsx
from app.crud.customers import CustomerManager
from app.crud.debts import DebtManager
from app.models import Customer, CustomerContact
from app.schemas.customer import (
    ContactIn,
    ContactOut,
    ContactPatch,
    CustomerIn,
    CustomerOut,
    CustomerExport,
    CustomerPage,
    CustomerQuery,
    CustomerPatch,
    CustomerRow,
)

router = APIRouter(prefix="/customers", tags=["Customers"])


def _manager(session, current) -> CustomerManager:
    return CustomerManager(session, current[1].id)


def _log(session, current) -> ActivityLog:
    user, tenant = current
    return ActivityLog(session, tenant.id, user.id)


async def _customer(m: CustomerManager, customer_id: int) -> Customer:
    customer = await m.get(customer_id)
    if customer is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return customer


def _contact(customer: Customer, contact_id: int) -> CustomerContact:
    for c in customer.contacts:
        if c.id == contact_id:
            return c
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")


@router.get("", response_model=CustomerPage)
async def list_customers(
    session: SessionDep,
    current: CurrentUser,
    f: Annotated[CustomerQuery, Query()],
):
    return CustomerPage(**await _list(session, current, f, f.limit, f.offset))


async def _list(session, current, f, limit: int, offset: int) -> dict:
    rows, total = await _manager(session, current).page(
        f.q, f.archived, f.sort, limit, offset
    )
    # what they owe is money: only for those who may see it
    owed = (
        await DebtManager(session, current[1]).balances_of([c.id for c, _ in rows])
        if allowed(current, "money.read")
        else {}
    )
    items = [
        {
            **CustomerRow.model_validate(c).model_dump(),
            "last_order": last,
            "balances": owed.get(c.id, []),
        }
        for c, last in rows
    ]
    return {"items": items, "total": total}


@router.get("/export")
async def export_customers(
    session: SessionDep, current: CurrentUser, f: Annotated[CustomerExport, Query()]
):
    page = await _list(session, current, f, MAX_ROWS, 0)
    return xlsx(
        "customers",
        f.lang,
        [
            ("name", "text"),
            ("inn", "text"),
            ("phone", "text"),
            ("address", "text"),
            ("balance", "text"),
            ("last_order", "date"),
        ],
        [
            [
                c["name"],
                c["inn"],
                c["phone"],
                c["address"],
                "; ".join(f"{b['balance']} {b['currency']}" for b in c["balances"]),
                c["last_order"],
            ]
            for c in page["items"]
        ],
    )


# declared before /{customer_id}, which would otherwise catch "similar"
@router.get("/similar", response_model=list[CustomerRow])
async def similar_customers(
    session: SessionDep,
    current: CurrentUser,
    name: Annotated[str, Query(max_length=200)],
    exclude: int | None = None,
):
    return await _manager(session, current).similar(name, exclude)


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
async def create_customer(data: CustomerIn, session: SessionDep, current: CurrentUser):
    customer = await _manager(session, current).create(data)
    _log(session, current).add("customer", customer.id, "created", customer.id)
    return customer


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: int, session: SessionDep, current: CurrentUser):
    return await _customer(_manager(session, current), customer_id)


@router.patch("/{customer_id}", response_model=CustomerOut)
async def update_customer(
    customer_id: int, data: CustomerPatch, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    customer = await _customer(m, customer_id)
    fields = data.model_dump(exclude_unset=True)
    was_archived = customer.archived
    before = snapshot(customer, [f for f in fields if f != "archived"])
    await m.update(customer, data)
    log = _log(session, current)
    if diff := changes(before, customer):
        log.add("customer", customer.id, "updated", customer.id, changes=diff)
    if customer.archived != was_archived:
        action = "archived" if customer.archived else "restored"
        log.add("customer", customer.id, action, customer.id)
    return customer


@router.post(
    "/{customer_id}/contacts",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_contact(
    customer_id: int, data: ContactIn, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    contact = await m.add_contact(await _customer(m, customer_id), data)
    _log(session, current).add(
        "customer", customer_id, "contact_added", customer_id, name=contact.name
    )
    return contact


@router.patch("/{customer_id}/contacts/{contact_id}", response_model=ContactOut)
async def update_contact(
    customer_id: int,
    contact_id: int,
    data: ContactPatch,
    session: SessionDep,
    current: CurrentUser,
):
    m = _manager(session, current)
    customer = await _customer(m, customer_id)
    return await m.update_contact(_contact(customer, contact_id), data)


@router.delete(
    "/{customer_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_contact(
    customer_id: int, contact_id: int, session: SessionDep, current: CurrentUser
):
    m = _manager(session, current)
    customer = await _customer(m, customer_id)
    contact = _contact(customer, contact_id)
    await m.delete_contact(customer, contact)
    _log(session, current).add(
        "customer", customer_id, "contact_deleted", customer_id, name=contact.name
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
