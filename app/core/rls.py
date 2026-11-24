"""Row-level security helpers for migrations.

The app connects as APP_ROLE, which owns no tables, so Postgres applies the policies to it.
Each transaction sets app.tenant_id (see set_tenant); a policy lets a row through only when its
tenant_id matches. With no tenant set, app_current_tenant() is NULL and nothing matches.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

APP_ROLE = "open_erp_app"


def enable_rls(op, table: str, column: str = "tenant_id") -> None:
    """Call in the migration that creates any table with a tenant_id."""
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING ({column} = app_current_tenant()) "
        f"WITH CHECK ({column} = app_current_tenant())"
    )


async def set_tenant(session: AsyncSession, tenant_id: int) -> None:
    # is_local=true: like SET LOCAL, it ends with the transaction, so a pooled
    # connection can't carry one company into the next request
    await session.execute(
        text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
    )
