from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.permissions import PERMISSIONS
from app.models.base import Base, TenantMixin


class Role(TenantMixin, Base):
    """A company's role: a name and the permissions it gives (app/core/permissions.py). The owner
    role is one per company, has every permission whatever `permissions` says, and can't be deleted.
    """

    name: Mapped[str] = mapped_column(String(60))
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String), server_default="{}")
    is_owner: Mapped[bool] = mapped_column(server_default="false")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name"),
        # lets users point at (id, tenant_id), so nobody holds another company's role
        UniqueConstraint("id", "tenant_id"),
        Index(
            "uq_role_one_owner",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_owner"),
        ),
    )

    @property
    def granted(self) -> frozenset[str]:
        return frozenset(PERMISSIONS) if self.is_owner else frozenset(self.permissions)


class User(TenantMixin, Base):
    __tablename__ = "app_user"  # "user" is a reserved word in Postgres

    name: Mapped[str] = mapped_column()
    # any of these can be typed into the login box; unique across all companies
    phone: Mapped[str | None] = mapped_column(unique=True)
    email: Mapped[str | None] = mapped_column(unique=True)
    username: Mapped[str | None] = mapped_column(unique=True)
    # empty for people who only sign in with Google or Telegram (planned)
    password_hash: Mapped[str | None] = mapped_column()
    role_id: Mapped[int] = mapped_column(BigInteger, index=True)
    is_active: Mapped[bool] = mapped_column(server_default="true")

    # loaded with the user, since every request checks its permissions; set role_id to change it
    role: Mapped[Role] = relationship(
        primaryjoin="User.role_id == Role.id",
        foreign_keys=[role_id],
        lazy="joined",
        viewonly=True,
    )

    __table_args__ = (
        CheckConstraint(
            "phone IS NOT NULL OR email IS NOT NULL OR username IS NOT NULL",
            name="has_login",
        ),
        ForeignKeyConstraint(["role_id", "tenant_id"], ["role.id", "role.tenant_id"]),
        # lets tasks point at (id, tenant_id), so a task can't name another company's user
        UniqueConstraint("id", "tenant_id"),
    )
