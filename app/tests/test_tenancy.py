"""Proof that one company can never see or change another company's rows."""

import unittest

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.database import db_helper
from app.core.rls import APP_ROLE, set_tenant
from app.tests.db import needs_db, random_phone


@needs_db
class TenantIsolationTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # two companies with one user each, created the way sign-up does it
        self.a, self.user_a = await self._company("A")
        self.b, self.user_b = await self._company("B")

    async def asyncTearDown(self):
        await db_helper.dispose()  # each test runs in its own event loop

    async def _company(self, name):
        async with db_helper.session_factory() as s:
            tenant = (
                await s.execute(text("SELECT auth_create_tenant(:n)"), {"n": name})
            ).scalar_one()
            await set_tenant(s, tenant)
            role = (
                await s.execute(
                    text(
                        "INSERT INTO role (tenant_id, name, is_owner) "
                        "VALUES (:t, 'Owner', true) RETURNING id"
                    ),
                    {"t": tenant},
                )
            ).scalar_one()
            user = (
                await s.execute(
                    text(
                        "INSERT INTO app_user (tenant_id, name, phone, role_id) "
                        "VALUES (:t, :n, :p, :r) RETURNING id"
                    ),
                    {"t": tenant, "n": name, "p": random_phone(), "r": role},
                )
            ).scalar_one()
            await s.commit()
            return tenant, user

    async def _ids(self, s, sql):
        return {r[0] for r in (await s.execute(text(sql))).all()}

    async def test_reads_see_only_own_company(self):
        async with db_helper.session_factory() as s:
            await set_tenant(s, self.a)
            users = await self._ids(s, "SELECT id FROM app_user")
            self.assertIn(self.user_a, users)
            self.assertNotIn(self.user_b, users)
            self.assertEqual(await self._ids(s, "SELECT id FROM tenant"), {self.a})

    async def test_no_company_set_sees_nothing(self):
        async with db_helper.session_factory() as s:
            self.assertEqual(await self._ids(s, "SELECT id FROM app_user"), set())
            self.assertEqual(await self._ids(s, "SELECT id FROM tenant"), set())

    async def test_cannot_change_other_company_rows(self):
        async with db_helper.session_factory() as s:
            await set_tenant(s, self.a)
            updated = await s.execute(
                text("UPDATE app_user SET name = 'x' WHERE id = :id"),
                {"id": self.user_b},
            )
            deleted = await s.execute(
                text("DELETE FROM app_user WHERE id = :id"), {"id": self.user_b}
            )
            self.assertEqual((updated.rowcount, deleted.rowcount), (0, 0))

    async def test_cannot_insert_into_other_company(self):
        async with db_helper.session_factory() as s:
            await set_tenant(s, self.a)
            with self.assertRaisesRegex(DBAPIError, "row-level security"):
                await s.execute(
                    text(
                        "INSERT INTO app_user (tenant_id, name, phone) VALUES (:t, 'x', :p)"
                    ),
                    {"t": self.b, "p": random_phone()},
                )

    async def test_cannot_move_own_row_to_other_company(self):
        async with db_helper.session_factory() as s:
            await set_tenant(s, self.a)
            with self.assertRaisesRegex(DBAPIError, "row-level security"):
                await s.execute(
                    text("UPDATE app_user SET tenant_id = :b WHERE id = :id"),
                    {"b": self.b, "id": self.user_a},
                )

    async def test_company_does_not_leak_into_next_transaction(self):
        async with db_helper.engine.connect() as conn:
            async with conn.begin():
                await conn.execute(
                    text("SELECT set_config('app.tenant_id', :t, true)"),
                    {"t": str(self.a)},
                )
            async with conn.begin():
                tenant = (
                    await conn.execute(text("SELECT app_current_tenant()"))
                ).scalar()
                self.assertIsNone(tenant)

    async def test_app_role_cannot_turn_off_security(self):
        async with db_helper.session_factory() as s:
            with self.assertRaisesRegex(DBAPIError, "must be owner"):
                await s.execute(text("ALTER TABLE app_user DISABLE ROW LEVEL SECURITY"))

    async def test_app_role_owns_nothing_and_is_not_superuser(self):
        async with db_helper.session_factory() as s:
            me = (await s.execute(text("SELECT current_user"))).scalar()
            self.assertEqual(me, APP_ROLE)
            row = (
                await s.execute(
                    text(
                        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
                    )
                )
            ).one()
            self.assertEqual(tuple(row), (False, False))
            owned = await self._ids(
                s,
                "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user",
            )
            self.assertEqual(owned, set())

    async def test_every_company_table_has_a_policy(self):
        # catches a new table whose migration forgot enable_rls()
        async with db_helper.session_factory() as s:
            unprotected = await self._ids(
                s,
                """
                SELECT c.relname FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                  AND c.relname NOT IN ('auth_session')
                  AND (NOT c.relrowsecurity
                       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
                """,
            )
            self.assertEqual(unprotected, set())


if __name__ == "__main__":
    unittest.main()
