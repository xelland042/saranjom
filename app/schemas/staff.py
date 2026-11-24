import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.core.permissions import GRANTABLE

Name = Annotated[str, Field(min_length=1, max_length=200)]
Password = Annotated[str, Field(min_length=8, max_length=128)]
RoleName = Annotated[str, Field(min_length=1, max_length=60)]
Grantable = Literal[GRANTABLE]  # type: ignore[valid-type]


class StaffIn(BaseModel):
    """A person the owner adds: they log in with this phone, email or username and password."""

    name: Name
    login: Annotated[str, Field(min_length=3, max_length=254)]
    password: Password
    role_id: int


class StaffPatch(BaseModel):
    name: Name | None = None
    role_id: int | None = None
    active: bool | None = None  # off: can't log in, sessions end at once
    password: Password | None = None  # a new one, set by the owner; their sessions end


class StaffOut(BaseModel):
    id: int
    name: str
    role_id: int
    role: str  # the role's name
    active: bool
    # how they log in: shown to whoever manages staff, empty for everyone else
    phone: str | None = None
    email: str | None = None
    username: str | None = None
    created_at: dt.datetime | None = None


class RoleIn(BaseModel):
    name: RoleName
    permissions: list[Grantable] = []


class RolePatch(BaseModel):
    name: RoleName | None = None
    permissions: list[Grantable] | None = (
        None  # not for the owner role, which has them all
    )


class RoleOut(BaseModel):
    id: int
    name: str
    owner: bool
    permissions: list[str]  # what it gives: every one for the owner role
    people: int  # active people holding it
