from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import db_helper
from app.core.rls import set_tenant
from app.core.security import (
    DUMMY_HASH,
    hash_password,
    new_session_token,
    parse_login,
    token_hash,
    verify_password,
)
from app.crud.products import ProductManager
from app.crud.staff import StaffManager
from app.crud.stock import StockManager
from app.crud.tasks import TaskManager
from app.models import AuthSession, LoginFailure, Tenant, User
from app.schemas.auth import SignupIn


class LoginFailed(Exception): ...


class TooManyAttempts(Exception): ...


class AuthManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def signup(self, data: SignupIn) -> str:
        """Create a company and its owner, and log the owner in. Returns the session token."""
        kind, login = parse_login(data.login)
        tenant_id = (
            await self.session.execute(
                text("SELECT auth_create_tenant(:name)"), {"name": data.company_name}
            )
        ).scalar_one()
        await set_tenant(self.session, tenant_id)
        owner_role = await StaffManager(
            self.session, tenant_id, None
        ).create_default_roles(data.lang)
        user = User(
            tenant_id=tenant_id,
            name=data.name,
            password_hash=await run_in_threadpool(hash_password, data.password),
            role_id=owner_role,
            **{kind: login},
        )
        self.session.add(user)
        await self.session.flush()  # a taken login fails here: 409 via app/core/errors.py
        await ProductManager(self.session, tenant_id).create_default_price_list(
            "UZS", data.lang
        )
        await StockManager(self.session, tenant_id).create_default_warehouse(data.lang)
        await TaskManager(self.session, tenant_id, user.id).create_default_stages(
            data.lang
        )
        return await self._start_session(user.id, tenant_id)

    async def login(self, raw_login: str, password: str, ip: str) -> str:
        try:
            _, login = parse_login(raw_login)
        except ValueError:
            login = raw_login.strip().lower()
        await self._check_rate_limit(login, ip)
        row = (
            await self.session.execute(
                text("SELECT * FROM auth_find_user(:login)"), {"login": login}
            )
        ).first()
        stored = row.password_hash if row and row.password_hash else DUMMY_HASH
        ok = await run_in_threadpool(verify_password, password, stored)
        if not (ok and row and row.password_hash and row.is_active):
            await self._record_failure(login, ip)
            raise LoginFailed
        return await self._start_session(row.id, row.tenant_id)

    async def current_user(self, token: str) -> tuple[User, Tenant] | None:
        """Find the session's user and switch this transaction to their company."""
        auth = (
            await self.session.execute(
                select(AuthSession).where(
                    AuthSession.token_hash == token_hash(token),
                    AuthSession.expires_at > func.now(),
                )
            )
        ).scalar_one_or_none()
        if auth is None:
            return None
        await set_tenant(self.session, auth.tenant_id)
        user = await self.session.get(User, auth.user_id)
        if user is None or not user.is_active:
            return None
        return user, await self.session.get(Tenant, auth.tenant_id)

    async def change_password(
        self, user: User, token: str, current: str, new: str, ip: str
    ) -> None:
        """The person's own new password. Wrong guesses count like failed logins, so a stolen
        session can't be used to try passwords; every other session of theirs ends.
        """
        login = user.phone or user.email or user.username or ""
        await self._check_rate_limit(login, ip)
        stored = user.password_hash or DUMMY_HASH
        ok = await run_in_threadpool(verify_password, current, stored)
        if not (ok and user.password_hash):
            await self._record_failure(login, ip)
            raise LoginFailed
        user.password_hash = await run_in_threadpool(hash_password, new)
        await self.session.execute(
            delete(AuthSession).where(
                AuthSession.user_id == user.id,
                AuthSession.token_hash != token_hash(token),
            )
        )
        await self.session.flush()

    async def logout(self, token: str) -> None:
        await self.session.execute(
            delete(AuthSession).where(AuthSession.token_hash == token_hash(token))
        )

    async def _start_session(self, user_id: int, tenant_id: int) -> str:
        token = new_session_token()
        self.session.add(
            AuthSession(
                token_hash=token_hash(token),
                user_id=user_id,
                tenant_id=tenant_id,
                expires_at=datetime.now(timezone.utc)
                + timedelta(days=settings.auth.session_days),
            )
        )
        await self.session.flush()
        return token

    async def _check_rate_limit(self, login: str, ip: str) -> None:
        since = datetime.now(timezone.utc) - timedelta(
            minutes=settings.auth.failure_window_minutes
        )
        failures = (
            await self.session.execute(
                select(func.count())
                .select_from(LoginFailure)
                .where(
                    LoginFailure.created_at > since,
                    or_(LoginFailure.login == login, LoginFailure.ip == ip),
                )
            )
        ).scalar_one()
        if failures >= settings.auth.max_failures:
            raise TooManyAttempts

    async def _record_failure(self, login: str, ip: str) -> None:
        # its own transaction: the request's transaction rolls back on the 401
        async with db_helper.session_factory() as s:
            s.add(LoginFailure(login=login, ip=ip))
            # keep the table small: older rows no longer count
            await s.execute(
                delete(LoginFailure).where(
                    LoginFailure.created_at < func.now() - timedelta(days=1)
                )
            )
            await s.commit()
