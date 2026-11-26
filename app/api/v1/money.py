from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser
from app.core.database import SessionDep
from app.core.xlsx import (
    MAX_ROWS,
    MONEY_CATEGORY,
    MONEY_KIND,
    PLACE,
    STATUS,
    word,
    xlsx,
)
from app.crud.activity import ActivityLog
from app.crud.money import MoneyManager
from app.crud.profit import ProfitReport
from app.models import MoneyMove
from app.schemas.money import (
    MoneyExport,
    MoneyPage,
    MoneyQuery,
    MoveIn,
    MoveOut,
    ProfitOut,
    ProfitQuery,
)

router = APIRouter(tags=["Money"])


def _manager(session, current) -> MoneyManager:
    user, tenant = current
    return MoneyManager(session, tenant, user.id)


def _log(session, current, move: MoneyMove, action: str) -> None:
    user, tenant = current
    ActivityLog(session, tenant.id, user.id).add(
        "money_move",
        move.id,
        action,
        number=move.number,
        kind=move.kind,
        category=move.category,
        place=move.place,
        amount=move.amount,
        currency=move.currency,
    )


@router.get("/money", response_model=MoneyPage)
async def list_money(
    session: SessionDep, current: CurrentUser, f: Annotated[MoneyQuery, Query()]
):
    m = _manager(session, current)
    items, total, sums = await m.page(f, f.limit, f.offset)
    return MoneyPage(items=items, total=total, sums=sums, balances=await m.balances())


@router.get("/money/export")
async def export_money(
    session: SessionDep, current: CurrentUser, f: Annotated[MoneyExport, Query()]
):
    items, _, _ = await _manager(session, current).page(f, MAX_ROWS, 0)
    return xlsx(
        "money",
        f.lang,
        [
            ("date", "date"),
            ("kind", "text"),
            ("number", "int"),
            ("category", "text"),
            ("party", "text"),
            ("place", "text"),
            ("amount", "money"),
            ("currency", "text"),
            ("status", "text"),
            ("note", "text"),
        ],
        [
            [
                r["date"],
                word(MONEY_KIND, r["kind"], f.lang),
                r["number"],
                word(MONEY_CATEGORY, r["category"], f.lang) if r["category"] else "",
                # a transfer's other end stands where a payment has its customer or supplier
                r["party"]
                or (r["other_place"] and word(PLACE, r["other_place"], f.lang)),
                word(PLACE, r["place"], f.lang),
                r["amount"],
                r["currency"],
                word(STATUS, "cancelled", f.lang) if r["cancelled_at"] else "",
                r["note"],
            ]
            for r in items
        ],
    )


@router.post("/money-moves", response_model=MoveOut, status_code=201)
async def add_move(data: MoveIn, session: SessionDep, current: CurrentUser):
    move = await _manager(session, current).add(data)
    _log(session, current, move, "created")
    return move


@router.post("/money-moves/{move_id}/cancel", response_model=MoveOut)
async def cancel_move(move_id: int, session: SessionDep, current: CurrentUser):
    """Keeps it in the list and stops it counting; a wrong one is entered again."""
    found = await _manager(session, current).cancel(move_id)
    if found is None:  # also when it belongs to another company
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    move, now = found
    if now:
        _log(session, current, move, "cancelled")
    return move


@router.get("/profit", response_model=ProfitOut)
async def profit(
    session: SessionDep, current: CurrentUser, f: Annotated[ProfitQuery, Query()]
):
    _, tenant = current
    return await ProfitReport(session, tenant).build(f.date_from, f.date_to)
