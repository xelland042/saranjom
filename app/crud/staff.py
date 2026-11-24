from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidField
from app.core.permissions import DEFAULT_ROLES, ROLE_PERMISSIONS, with_implied
from app.core.security import hash_password, parse_login
from app.models import AuthSession, Role, User
from app.schemas.staff import RoleIn, RolePatch, StaffIn, StaffPatch


class StaffManager:
    """The company's people and roles. Row-level security keeps it to the company on the session."""

    def __init__(self, session: AsyncSession, tenant_id: int, me: User | None):
        self.session = session
        self.tenant_id = tenant_id
        self.me = me

    async def people(self) -> list[User]:
        return list(
            await self.session.scalars(
                select(User).order_by(User.is_active.desc(), User.name, User.id)
            )
        )

    async def add(self, data: StaffIn) -> User:
        try:
            kind, login = parse_login(data.login)
        except ValueError:
            raise InvalidField("login", "A phone, email or username") from None
        await self._role(data.role_id)
        user = User(
            tenant_id=self.tenant_id,
            name=data.name,
            role_id=data.role_id,
            password_hash=await run_in_threadpool(hash_password, data.password),
            **{kind: login},
        )
        self.session.add(user)
        await self.session.flush()  # a login taken in any company: 409
        await self.session.refresh(user, ["role"])
        return user

    async def update(self, user: User, data: StaffPatch) -> User:
        fields = data.model_dump(exclude_unset=True)
        if user.id == self.me.id and (
            fields.get("role_id", user.role_id) != user.role_id
            or fields.get("active") is False
        ):
            # so nobody locks themselves (and maybe the company) out by mistake
            raise InvalidField(
                "role_id", "You can't change your own role or deactivate yourself"
            )
        if fields.get("name"):
            user.name = fields["name"]
        if fields.get("role_id"):
            await self._role(fields["role_id"])
            user.role_id = fields["role_id"]
        if fields.get("active") is not None:
            user.is_active = fields["active"]
        if fields.get("password"):
            user.password_hash = await run_in_threadpool(
                hash_password, fields["password"]
            )
        await self._keep_an_owner()
        if fields.get("password") or fields.get("active") is False:
            # whoever is logged in as them is logged out now
            await self.session.execute(
                delete(AuthSession).where(AuthSession.user_id == user.id)
            )
        await self.session.flush()
        await self.session.refresh(user, ["role"])
        return user

    async def _role(self, role_id: int) -> Role:
        role = await self.session.get(Role, role_id)
        if role is None:  # also another company's
            raise InvalidField("role_id", "No such role")
        return role

    async def _keep_an_owner(self) -> None:
        await self.session.flush()
        owners = await self.session.scalar(
            select(func.count())
            .select_from(User)
            .join(Role, Role.id == User.role_id)
            .where(Role.is_owner, User.is_active)
        )
        if not owners:
            raise InvalidField("role_id", "The company needs an active owner")

    # roles

    async def roles(self) -> list[tuple[Role, int]]:
        """Each role with how many active people hold it; the owner role first."""
        people = (
            select(func.count())
            .where(User.role_id == Role.id, User.is_active)
            .scalar_subquery()
        )
        rows = await self.session.execute(
            select(Role, people).order_by(Role.is_owner.desc(), Role.id)
        )
        return [(r, n) for r, n in rows.all()]

    async def create_default_roles(self, lang: str) -> int:
        """Called once, at sign-up: the four roles in the sign-up language. Returns the owner's."""
        roles = {
            key: Role(
                tenant_id=self.tenant_id,
                name=names.get(lang, names["uz"]),
                is_owner=key == "owner",
                permissions=[] if key == "owner" else sorted(ROLE_PERMISSIONS[key]),
            )
            for key, names in DEFAULT_ROLES.items()
        }
        self.session.add_all(roles.values())
        await self.session.flush()
        return roles["owner"].id

    async def add_role(self, data: RoleIn) -> Role:
        role = Role(
            tenant_id=self.tenant_id,
            name=data.name,
            permissions=sorted(with_implied(set(data.permissions))),
        )
        self.session.add(role)
        await self.session.flush()  # a taken name: 409
        return role

    async def update_role(self, role: Role, data: RolePatch) -> Role:
        if data.name:
            role.name = data.name
        if data.permissions is not None:
            if role.is_owner:
                raise InvalidField("permissions", "The owner role has every permission")
            role.permissions = sorted(with_implied(set(data.permissions)))
        await self.session.flush()  # a taken name: 409
        return role

    async def delete_role(self, role: Role) -> None:
        if role.is_owner:
            raise InvalidField("role", "The owner role can't be deleted")
        # inactive people keep their role too, so they need moving first as well
        held = await self.session.scalar(
            select(func.count()).where(User.role_id == role.id)
        )
        if held:
            raise InvalidField("role", "Give its people another role first")
        await self.session.delete(role)
        await self.session.flush()
