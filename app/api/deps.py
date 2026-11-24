from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.core.config import settings
from app.core.database import SessionDep
from app.core.permissions import ROUTES, can
from app.crud.auth import AuthManager
from app.models import Tenant, User


async def current_user(request: Request, session: SessionDep) -> tuple[User, Tenant]:
    """Every route that touches company data depends on this: it also sets the company
    for the request's transaction, so row-level security shows only that company's rows.
    """
    token = request.cookies.get(settings.auth.cookie_name)
    found = await AuthManager(session).current_user(token) if token else None
    if found is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return found


CurrentUser = Annotated[tuple[User, Tenant], Depends(current_user)]


async def authorize(request: Request, current: CurrentUser) -> None:
    """Every company route needs its permission (app/core/permissions.py); unlisted ones none."""
    route = request.scope["route"].path.removeprefix(
        settings.api.prefix + settings.api.v1.prefix
    )
    key = f"{request.method} {route}"
    if key not in ROUTES or not can(current[0].role.granted, ROUTES[key]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")


def allowed(current: tuple[User, Tenant], permission: str) -> bool:
    """For data a route shows only to some roles (debts on the customer list)."""
    return can(current[0].role.granted, permission)
