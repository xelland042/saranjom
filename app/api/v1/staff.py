from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, allowed
from app.core.database import SessionDep
from app.crud.staff import StaffManager
from app.models import Role, User
from app.schemas.staff import (
    RoleIn,
    RoleOut,
    RolePatch,
    StaffIn,
    StaffOut,
    StaffPatch,
)

router = APIRouter(prefix="/staff", tags=["Staff"])
roles_router = APIRouter(prefix="/roles", tags=["Staff"])


def _out(u: User, full: bool) -> StaffOut:
    base = {
        "id": u.id,
        "name": u.name,
        "role_id": u.role_id,
        "role": u.role.name,
        "active": u.is_active,
    }
    if full:
        base |= {
            "phone": u.phone,
            "email": u.email,
            "username": u.username,
            "created_at": u.created_at,
        }
    return StaffOut(**base)


@router.get("", response_model=list[StaffOut])
async def list_staff(session: SessionDep, current: CurrentUser):
    """Everyone sees names and roles (to assign tasks); logins only with the staff permission."""
    full = allowed(current, "staff")
    people = await StaffManager(session, current[1].id, current[0]).people()
    return [_out(u, full) for u in people]


@router.post("", response_model=StaffOut, status_code=status.HTTP_201_CREATED)
async def add_staff(data: StaffIn, session: SessionDep, current: CurrentUser):
    return _out(await StaffManager(session, current[1].id, current[0]).add(data), True)


@router.patch("/{user_id}", response_model=StaffOut)
async def update_staff(
    user_id: int, data: StaffPatch, session: SessionDep, current: CurrentUser
):
    user = await session.get(User, user_id)
    if user is None:  # also another company's
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    m = StaffManager(session, current[1].id, current[0])
    return _out(await m.update(user, data), True)


def _role_out(r: Role, people: int) -> RoleOut:
    return RoleOut(
        id=r.id,
        name=r.name,
        owner=r.is_owner,
        permissions=sorted(r.granted),
        people=people,
    )


async def _role(session: SessionDep, role_id: int) -> Role:
    role = await session.get(Role, role_id)
    if role is None:  # also another company's
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    return role


@roles_router.get("", response_model=list[RoleOut])
async def list_roles(session: SessionDep, current: CurrentUser):
    roles = await StaffManager(session, current[1].id, current[0]).roles()
    return [_role_out(r, n) for r, n in roles]


@roles_router.post("", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
async def add_role(data: RoleIn, session: SessionDep, current: CurrentUser):
    role = await StaffManager(session, current[1].id, current[0]).add_role(data)
    return _role_out(role, 0)


@roles_router.patch("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: int, data: RolePatch, session: SessionDep, current: CurrentUser
):
    m = StaffManager(session, current[1].id, current[0])
    role = await m.update_role(await _role(session, role_id), data)
    return _role_out(role, next(n for r, n in await m.roles() if r.id == role.id))


@roles_router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(role_id: int, session: SessionDep, current: CurrentUser):
    m = StaffManager(session, current[1].id, current[0])
    await m.delete_role(await _role(session, role_id))
