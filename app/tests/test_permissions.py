import unittest

import httpx

from app.core.config import settings
from app.core.database import db_helper
from app.core.permissions import DEFAULT_ROLES, ROUTES
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"
# no permission needed: before login, or a logged-in person's own account
PUBLIC = {
    "POST /auth/signup",
    "POST /auth/login",
    "POST /auth/logout",
    "GET /auth/me",
    "POST /auth/password",
}


class RouteTableTest(unittest.TestCase):
    def test_every_route_has_a_permission_and_the_table_has_no_stale_ones(self):
        prefix = settings.api.prefix + settings.api.v1.prefix
        # from the app's own description of itself (OpenAPI): how the framework nests routers
        # inside has changed between its versions, this hasn't
        routes = {
            f"{method.upper()} {path.removeprefix(prefix)}"
            for path, operations in main_app.openapi()["paths"].items()
            if path.startswith(prefix)
            for method in operations
        }
        self.assertGreater(len(routes), 50, "the route list came out empty")
        self.assertEqual(
            routes - PUBLIC - set(ROUTES), set(), "routes without a permission"
        )
        self.assertEqual(
            set(ROUTES) - routes, set(), "permissions for routes that are gone"
        )


@needs_db
class PermissionsApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.owner = await self._client()
        await self._ok(
            await self.owner.post(
                f"{API}/auth/signup",
                json={
                    "company_name": "T",
                    "name": "Owner",
                    "login": random_phone(),
                    "password": "secret-123",
                },
            ),
            201,
        )
        roles = await self._ok(await self.owner.get(f"{API}/roles"))
        by_name = {r["name"]: r["id"] for r in roles}
        self.role_ids = {k: by_name[n["uz"]] for k, n in DEFAULT_ROLES.items()}
        self.people = {}
        for role in ("manager", "storekeeper", "accountant"):
            login = random_phone()
            person = await self._ok(
                await self.owner.post(
                    f"{API}/staff",
                    json={
                        "name": role.title(),
                        "login": login,
                        "password": "secret-456",
                        "role_id": self.role_ids[role],
                    },
                ),
                201,
            )
            client = await self._client()
            await self._ok(
                await client.post(
                    f"{API}/auth/login", json={"login": login, "password": "secret-456"}
                )
            )
            self.people[role] = (person, client, login)
        self.customer = await self._ok(
            await self.owner.post(f"{API}/customers", json={"name": "Baraka"}), 201
        )
        self.product = await self._ok(
            await self.owner.post(
                f"{API}/products", json={"name": "Un", "unit": "bag"}
            ),
            201,
        )
        o = await self._ok(
            await self.owner.post(
                f"{API}/orders",
                json={
                    "customer_id": self.customer["id"],
                    "lines": [
                        {
                            "product_id": self.product["id"],
                            "quantity": "1",
                            "price": "100",
                        }
                    ],
                },
            ),
            201,
        )
        await self._ok(await self.owner.post(f"{API}/orders/{o['id']}/confirm"))
        await self._ok(
            await self.owner.post(
                f"{API}/payments",
                json={"customer_id": self.customer["id"], "amount": "40"},
            ),
            201,
        )

    async def asyncTearDown(self):
        await self.owner.aclose()
        for _, client, _ in self.people.values():
            await client.aclose()
        await db_helper.dispose()

    async def _client(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        return httpx.AsyncClient(transport=transport, base_url="https://test")

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json() if r.content else None

    def _as(self, role):
        return self.people[role][1]

    async def _codes(self, client, calls):
        out = []
        for method, path, body in calls:
            r = await client.request(method, f"{API}{path}", json=body)
            out.append(r.status_code)
        return out

    async def test_each_role_gets_what_its_job_needs_and_nothing_more(self):
        order = {
            "customer_id": self.customer["id"],
            "lines": [
                {"product_id": self.product["id"], "quantity": "1", "price": "1"}
            ],
        }
        receipt = {
            "kind": "receipt",
            "warehouse_id": (await self._ok(await self.owner.get(f"{API}/warehouses")))[
                0
            ]["id"],
            "lines": [{"product_id": self.product["id"], "quantity": "5"}],
        }
        pay = {"customer_id": self.customer["id"], "amount": "1"}
        calls = [
            ("POST", "/orders", order),
            ("POST", "/stock-documents", receipt),
            ("POST", "/payments", pay),
            ("GET", "/debts", None),
            ("GET", "/dashboard", None),
            ("POST", "/products", {"name": "X", "unit": "pcs"}),
            ("POST", "/vat-rates", {"rate": "12", "valid_from": "2020-01-01"}),
            (
                "POST",
                "/staff",
                {
                    "name": "X",
                    "login": random_phone(),
                    "password": "secret-789",
                    "role_id": self.role_ids["manager"],
                },
            ),
        ]
        expect = {
            "manager": [201, 403, 201, 200, 200, 403, 403, 403],
            "storekeeper": [403, 201, 403, 403, 403, 403, 403, 403],
            "accountant": [403, 403, 201, 200, 200, 403, 201, 403],
        }
        for role, codes in expect.items():
            self.assertEqual(await self._codes(self._as(role), calls), codes, role)
        me = await self._ok(await self._as("storekeeper").get(f"{API}/auth/me"))
        self.assertEqual(me["role"], DEFAULT_ROLES["storekeeper"]["uz"])
        self.assertIn("stock.write", me["permissions"])
        self.assertNotIn("money.read", me["permissions"])

    async def test_a_storekeeper_never_sees_money(self):
        s = self._as("storekeeper")
        listed = await self._ok(await s.get(f"{API}/customers"))
        self.assertEqual(listed["items"][0]["balances"], [])
        owner_view = await self._ok(await self.owner.get(f"{API}/customers"))
        self.assertEqual(owner_view["items"][0]["balances"][0]["balance"], "60.00")
        feed = await self._ok(
            await s.get(f"{API}/activity", params={"customer_id": self.customer["id"]})
        )
        self.assertNotIn("payment", {a["entity"] for a in feed})
        self.assertIn("order", {a["entity"] for a in feed})
        r = await s.get(
            f"{API}/customers/{self.customer['id']}/statement",
            params={"currency": "UZS"},
        )
        self.assertEqual(r.status_code, 403)

    async def test_staff_list_shows_logins_only_to_the_owner(self):
        mine = await self._ok(await self.owner.get(f"{API}/staff"))
        theirs = await self._ok(await self._as("manager").get(f"{API}/staff"))
        self.assertEqual(len(mine), 4)
        self.assertTrue(all(p["phone"] for p in mine))
        self.assertEqual({p["phone"] for p in theirs}, {None})
        self.assertEqual({p["name"] for p in theirs}, {p["name"] for p in mine})

    async def test_deactivating_or_a_new_password_logs_them_out(self):
        person, client, login = self.people["manager"]
        url = f"{API}/staff/{person['id']}"
        await self._ok(await self.owner.patch(url, json={"password": "fresh-pass-1"}))
        self.assertEqual((await client.get(f"{API}/auth/me")).status_code, 401)
        r = await client.post(
            f"{API}/auth/login", json={"login": login, "password": "fresh-pass-1"}
        )
        self.assertEqual(r.status_code, 200)
        await self._ok(await self.owner.patch(url, json={"active": False}))
        self.assertEqual((await client.get(f"{API}/auth/me")).status_code, 401)
        r = await client.post(
            f"{API}/auth/login", json={"login": login, "password": "fresh-pass-1"}
        )
        self.assertEqual(r.status_code, 401)

    async def test_the_company_keeps_an_owner_and_logins_stay_unique(self):
        staff = await self._ok(await self.owner.get(f"{API}/staff"))
        me = next(p for p in staff if p["role_id"] == self.role_ids["owner"])
        # nobody demotes or deactivates themselves
        for patch in ({"role_id": self.role_ids["manager"]}, {"active": False}):
            r = await self.owner.patch(f"{API}/staff/{me['id']}", json=patch)
            self.assertEqual(r.status_code, 422)
        # a second owner can take over, and then the first may step down
        manager = self.people["manager"][0]
        await self._ok(
            await self.owner.patch(
                f"{API}/staff/{manager['id']}",
                json={"role_id": self.role_ids["owner"]},
            )
        )
        await self._ok(
            await self.people["manager"][1].patch(
                f"{API}/staff/{me['id']}",
                json={"role_id": self.role_ids["manager"]},
            )
        )
        # the first one, now a manager, can't manage staff any more; the new owner can
        new_owner = self.people["manager"][1]
        r = await self.owner.post(f"{API}/staff", json={})
        self.assertEqual(r.status_code, 403)
        taken = self.people["accountant"][2]
        r = await new_owner.post(
            f"{API}/staff",
            json={
                "name": "X",
                "login": taken,
                "password": "secret-999",
                "role_id": self.role_ids["manager"],
            },
        )
        self.assertEqual(r.status_code, 409)
        bad = await new_owner.post(
            f"{API}/staff",
            json={
                "name": "X",
                "login": "someone",
                "password": "secret-999",
                "role_id": 10**12,
            },
        )
        self.assertEqual(bad.status_code, 422)

    async def test_tasks_are_assigned_to_people_of_the_company(self):
        manager, client, _ = self.people["manager"]
        t = await self._ok(
            await self.owner.post(
                f"{API}/tasks", json={"title": "Call", "assignee_id": manager["id"]}
            ),
            201,
        )
        self.assertEqual(t["assignee_name"], "Manager")
        mine = await self._ok(await client.get(f"{API}/tasks", params={"mine": "true"}))
        self.assertEqual([x["title"] for x in mine["items"]], ["Call"])
        # the dock's count is each person's own
        await self._ok(
            await self.owner.post(
                f"{API}/tasks",
                json={
                    "title": "Late",
                    "due_date": "2020-01-01",
                    "assignee_id": manager["id"],
                },
            ),
            201,
        )
        counts = await self._ok(
            await client.get(f"{API}/tasks/summary", params={"mine": "true"})
        )
        self.assertEqual(counts["overdue"], 1)
        owners = await self._ok(
            await self.owner.get(f"{API}/tasks/summary", params={"mine": "true"})
        )
        self.assertEqual(owners["overdue"], 0)
        other = await self._client()
        await other.post(
            f"{API}/auth/signup",
            json={
                "company_name": "B",
                "name": "B",
                "login": random_phone(),
                "password": "secret-123",
            },
        )
        stranger = (await self._ok(await other.get(f"{API}/staff")))[0]
        r = await self.owner.post(
            f"{API}/tasks", json={"title": "x", "assignee_id": stranger["id"]}
        )
        self.assertEqual(r.status_code, 422)
        r = await other.patch(f"{API}/staff/{manager['id']}", json={"name": "Z"})
        self.assertEqual(r.status_code, 404)
        # nor can a person be given another company's role
        theirs = (await self._ok(await other.get(f"{API}/roles")))[0]
        r = await self.owner.patch(
            f"{API}/staff/{manager['id']}", json={"role_id": theirs["id"]}
        )
        self.assertEqual(r.status_code, 422)
        await other.aclose()

    async def test_a_company_makes_its_own_roles(self):
        person, client, _ = self.people["storekeeper"]
        self.assertEqual((await client.get(f"{API}/debts")).status_code, 403)
        # changing implies seeing
        role = await self._ok(
            await self.owner.post(
                f"{API}/roles",
                json={"name": "Kassir", "permissions": ["money.write", "tasks"]},
            ),
            201,
        )
        self.assertEqual(role["permissions"], ["money.read", "money.write", "tasks"])
        await self._ok(
            await self.owner.patch(
                f"{API}/staff/{person['id']}", json={"role_id": role["id"]}
            )
        )
        # takes effect on their next request, no new login
        self.assertEqual((await client.get(f"{API}/debts")).status_code, 200)
        self.assertEqual((await client.get(f"{API}/stock")).status_code, 403)
        me = await self._ok(await client.get(f"{API}/auth/me"))
        self.assertEqual((me["role"], me["owner"]), ("Kassir", False))
        await self._ok(
            await self.owner.patch(
                f"{API}/roles/{role['id']}", json={"permissions": ["tasks"]}
            )
        )
        self.assertEqual((await client.get(f"{API}/debts")).status_code, 403)
        # managing staff is the owner role's alone, and the owner role can't be cut down
        r = await self.owner.post(
            f"{API}/roles", json={"name": "Boss", "permissions": ["staff"]}
        )
        self.assertEqual(r.status_code, 422)
        r = await self.owner.patch(
            f"{API}/roles/{self.role_ids['owner']}", json={"permissions": ["tasks"]}
        )
        self.assertEqual(r.status_code, 422)
        r = await self.owner.delete(f"{API}/roles/{self.role_ids['owner']}")
        self.assertEqual(r.status_code, 422)
        r = await self.owner.post(f"{API}/roles", json={"name": "Kassir"})
        self.assertEqual(r.status_code, 409)
        # a role in use can't go; an unused one can
        r = await self.owner.delete(f"{API}/roles/{role['id']}")
        self.assertEqual(r.status_code, 422)
        r = await self.owner.delete(f"{API}/roles/{self.role_ids['accountant']}")
        self.assertEqual(r.status_code, 422)
        empty = await self._ok(
            await self.owner.post(f"{API}/roles", json={"name": "Empty"}), 201
        )
        r = await self.owner.delete(f"{API}/roles/{empty['id']}")
        self.assertEqual(r.status_code, 204)
        listed = await self._ok(await self.owner.get(f"{API}/roles"))
        self.assertEqual(listed[0]["owner"], True)
        self.assertEqual({r["name"]: r["people"] for r in listed}["Kassir"], 1)
        self.assertEqual((await client.get(f"{API}/roles")).status_code, 403)


if __name__ == "__main__":
    unittest.main()
