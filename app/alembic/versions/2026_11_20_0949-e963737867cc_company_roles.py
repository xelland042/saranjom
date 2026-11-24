"""company roles

Revision ID: e963737867cc
Revises: 531321b7d23b
Create Date: 2026-11-20 09:49:13.475614

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.core.permissions import DEFAULT_ROLES, ROLE_PERMISSIONS
from app.core.rls import enable_rls

# revision identifiers, used by Alembic.
revision: str = "e963737867cc"
down_revision: Union[str, Sequence[str], None] = "531321b7d23b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "role",
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column(
            "permissions",
            postgresql.ARRAY(sa.String()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("is_owner", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenant.id"],
            name=op.f("fk_role_tenant_id_tenant"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_role")),
        sa.UniqueConstraint("id", "tenant_id", name=op.f("uq_role_id_tenant_id")),
        sa.UniqueConstraint("tenant_id", "name", name=op.f("uq_role_tenant_id_name")),
    )
    op.create_index(op.f("ix_role_tenant_id"), "role", ["tenant_id"], unique=False)
    op.create_index(
        "uq_role_one_owner",
        "role",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_owner"),
    )
    enable_rls(op, "role")
    # every company gets the four roles there were, in Uzbek (the sign-up default); the owner's
    # permissions stay empty, since it has them all anyway
    for key, names in DEFAULT_ROLES.items():
        owner = key == "owner"
        perms = [] if owner else sorted(ROLE_PERMISSIONS[key])
        op.execute(
            sa.text("""
                INSERT INTO role (tenant_id, name, permissions, is_owner)
                SELECT id, :name, :perms, :owner FROM tenant
                """).bindparams(
                sa.bindparam("perms", type_=postgresql.ARRAY(sa.String())),
                name=names["uz"],
                perms=perms,
                owner=owner,
            )
        )
    op.add_column("app_user", sa.Column("role_id", sa.BigInteger(), nullable=True))
    for key, names in DEFAULT_ROLES.items():
        op.execute(sa.text("""
                UPDATE app_user SET role_id = r.id FROM role r
                WHERE r.tenant_id = app_user.tenant_id AND r.name = :name
                  AND app_user.role = :key
                """).bindparams(name=names["uz"], key=key))
    op.alter_column("app_user", "role_id", nullable=False)
    op.create_index(op.f("ix_app_user_role_id"), "app_user", ["role_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_app_user_role_id_role"),
        "app_user",
        "role",
        ["role_id", "tenant_id"],
        ["id", "tenant_id"],
    )
    op.drop_column("app_user", "role")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "app_user",
        sa.Column("role", sa.String(), server_default="owner", nullable=False),
    )
    # back to the fixed four: the owner role stays owner, a role named like a default keeps it,
    # any other becomes manager
    for key, names in DEFAULT_ROLES.items():
        op.execute(sa.text("""
                UPDATE app_user SET role = :key FROM role r
                WHERE r.id = app_user.role_id AND r.name = :name
                """).bindparams(key=key, name=names["uz"]))
    op.execute("""
        UPDATE app_user SET role = CASE WHEN r.is_owner THEN 'owner' ELSE 'manager' END
        FROM role r WHERE r.id = app_user.role_id
          AND (r.is_owner OR r.name NOT IN ('Menejer', 'Omborchi', 'Buxgalter'))
        """)
    op.drop_constraint(op.f("fk_app_user_role_id_role"), "app_user", type_="foreignkey")
    op.drop_index(op.f("ix_app_user_role_id"), table_name="app_user")
    op.drop_column("app_user", "role_id")
    op.drop_index("uq_role_one_owner", table_name="role")
    op.drop_index(op.f("ix_role_tenant_id"), table_name="role")
    op.drop_table("role")
