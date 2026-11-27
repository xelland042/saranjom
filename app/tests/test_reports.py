import unittest
from datetime import timedelta

import httpx

from app.core import clock
from app.core.database import db_helper
from app.core.permissions import DEFAULT_ROLES
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class SalesReportApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.today = clock.today()
        self.a = await self._company()
        self.main = next(w for w in await self._get("/warehouses") if w["is_default"])
        self.baraka = await self._post("/customers", {"name": "Baraka Market"})
        self.oila = await self._post("/customers", {"name": "Oila Savdo"})
        self.flour = await self._post("/products", {"name": "Un", "unit": "bag"})
        self.sugar = await self._post("/products", {"name": "Shakar", "unit": "kg"})

    async def asyncTearDown(self):
        await self.a.aclose()
        await db_helper.dispose()

    async def _client(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        return httpx.AsyncClient(transport=transport, base_url="https://test")

    async def _company(self):
        client = await self._client()
        r = await client.post(
            f"{API}/auth/signup",
            json={
                "company_name": "Test",
                "name": "Rustam",
                "login": random_phone(),
                "password": "secret-123",
                "lang": "uz",
            },
        )
        self.assertEqual(r.status_code, 201)
        return client

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json() if r.content else None

    async def _post(self, path, body=None, code=201, client=None):
        return await self._ok(
            await (client or self.a).post(f"{API}{path}", json=body), code
        )

    async def _get(self, path, code=200, client=None, **params):
        return await self._ok(
            await (client or self.a).get(f"{API}{path}", params=params), code
        )

    def _day(self, ago):
        return str(self.today - timedelta(days=ago))

    async def _receive(self, product, quantity, price):
        return await self._post(
            "/stock-documents",
            {
                "kind": "receipt",
                "warehouse_id": self.main["id"],
                "currency": "UZS",
                "date": self._day(20),
                "lines": [
                    {"product_id": product["id"], "quantity": quantity, "price": price}
                ],
            },
        )

    async def _sell(self, customer, lines, ago=5, client=None):
        order = await self._post(
            "/orders",
            {
                "customer_id": customer["id"],
                "date": self._day(ago),
                "lines": [
                    {"product_id": p["id"], "quantity": q, "price": price}
                    for p, q, price in lines
                ],
            },
            client=client,
        )
        return await self._post(
            f"/orders/{order['id']}/confirm", code=200, client=client
        )

    async def _report(self, by="product", client=None, code=200, **more):
        params = {"date_from": self._day(10), "date_to": self._day(0)} | more
        return await self._get(
            "/reports/sales", by=by, client=client, code=code, **params
        )

    async def _staff(self, role):
        roles = await self._get("/roles")
        role_id = next(r["id"] for r in roles if r["name"] == DEFAULT_ROLES[role]["uz"])
        login = random_phone()
        await self._post(
            "/staff",
            {
                "name": "Dilnoza",
                "login": login,
                "password": "secret-456",
                "role_id": role_id,
            },
        )
        client = await self._client()
        self.addAsyncCleanup(client.aclose)
        await self._ok(
            await client.post(
                f"{API}/auth/login", json={"login": login, "password": "secret-456"}
            )
        )
        return client

    async def test_by_product_with_cost_profit_and_returns(self):
        await self._receive(self.flour, "100", "100")
        order = await self._sell(
            self.baraka, [(self.flour, "4", "150"), (self.sugar, "2", "80")]
        )
        await self._sell(self.oila, [(self.flour, "6", "150")])
        await self._post(
            f"/orders/{order['id']}/returns",
            {
                "lines": [{"order_line_id": order["lines"][0]["id"], "quantity": "1"}],
                "date": self._day(2),
            },
        )
        r = await self._report()
        self.assertEqual(r["currency"], "UZS")
        self.assertEqual(
            r["items"],
            [
                {
                    "id": self.flour["id"],
                    "name": "Un",
                    "unit": "bag",
                    "orders": 2,
                    "quantity": "9.000",
                    "sales": "1350.00",
                    "cost": "900.00",
                    "profit": "450.00",
                    "uncosted": "0.00",
                },
                # never received at a price: all of it counts as profit, and says so
                {
                    "id": self.sugar["id"],
                    "name": "Shakar",
                    "unit": "kg",
                    "orders": 1,
                    "quantity": "2.000",
                    "sales": "160.00",
                    "cost": "0.00",
                    "profit": "160.00",
                    "uncosted": "160.00",
                },
            ],
        )
        self.assertEqual(
            (r["sales"], r["cost"], r["profit"]), ("1510.00", "900.00", "610.00")
        )
        # the same sales as the profit report
        p = await self._get("/profit", date_from=self._day(10), date_to=self._day(0))
        self.assertEqual((p["sales"], p["cost"]), (r["sales"], r["cost"]))

    async def test_by_customer_and_sorting(self):
        await self._receive(self.flour, "100", "100")
        await self._sell(
            self.baraka, [(self.flour, "4", "150"), (self.sugar, "2", "80")]
        )
        await self._sell(self.oila, [(self.flour, "6", "150")])
        await self._sell(self.oila, [(self.flour, "1", "150")], ago=3)
        r = await self._report(by="customer")
        self.assertEqual(
            [
                (i["name"], i["orders"], i["sales"], i["profit"], i["uncosted"])
                for i in r["items"]
            ],
            [
                ("Oila Savdo", 2, "1050.00", "350.00", "0.00"),
                ("Baraka Market", 1, "760.00", "360.00", "160.00"),
            ],
        )
        self.assertIsNone(r["items"][0]["unit"])
        by_name = await self._report(by="customer", sort="name")
        self.assertEqual(
            [i["name"] for i in by_name["items"]], ["Baraka Market", "Oila Savdo"]
        )
        await self._report(by="customer", sort="id", code=422)
        await self._report(by="warehouse", code=422)

    async def test_by_person_who_entered_the_order(self):
        manager = await self._staff("manager")
        await self._sell(self.baraka, [(self.flour, "4", "150")])
        order = await self._sell(self.oila, [(self.flour, "2", "150")], client=manager)
        # the owner enters the return; it still comes off the seller's sales
        await self._post(
            f"/orders/{order['id']}/returns",
            {"lines": [{"order_line_id": order["lines"][0]["id"], "quantity": "1"}]},
        )
        r = await self._report(by="manager")
        self.assertEqual(
            [(i["name"], i["orders"], i["sales"]) for i in r["items"]],
            [("Rustam", 1, "600.00"), ("Dilnoza", 1, "150.00")],
        )

    async def test_only_the_period_and_what_still_counts(self):
        await self._sell(self.baraka, [(self.flour, "1", "150")], ago=30)
        gone = await self._sell(self.baraka, [(self.flour, "5", "150")])
        await self._post(f"/orders/{gone['id']}/cancel", code=200)
        await self._post(  # a draft
            "/orders",
            {
                "customer_id": self.baraka["id"],
                "lines": [
                    {"product_id": self.flour["id"], "quantity": "1", "price": "9"}
                ],
            },
        )
        r = await self._report()
        self.assertEqual((r["items"], r["sales"]), ([], "0.00"))
        await self._report(date_from=self._day(0), date_to=self._day(1), code=422)

    async def test_without_the_money_permission_there_is_no_cost(self):
        await self._receive(self.flour, "100", "100")
        await self._sell(self.baraka, [(self.flour, "4", "150")])
        keeper = await self._staff("storekeeper")  # sees orders, never money
        r = await self._report(client=keeper, sort="-profit")
        self.assertEqual((r["sales"], r["cost"], r["profit"]), ("600.00", None, None))
        row = r["items"][0]
        self.assertEqual(
            (row["sales"], row["cost"], row["profit"], row["uncosted"]),
            ("600.00", None, None, None),
        )
        other = await self._company()
        self.addAsyncCleanup(other.aclose)
        self.assertEqual((await self._report(client=other))["items"], [])

    async def test_excel_file(self):
        from io import BytesIO

        from openpyxl import load_workbook

        await self._receive(self.flour, "100", "100")
        await self._sell(self.baraka, [(self.flour, "4", "150")])
        params = {"date_from": self._day(10), "date_to": self._day(0), "lang": "ru"}
        r = await self.a.get(f"{API}/reports/sales/export", params=params)
        self.assertEqual(r.status_code, 200)
        rows = list(load_workbook(BytesIO(r.content)).active.values)
        self.assertEqual(
            rows,
            [
                ("Товар", "Ед.", "Количество", "Продажи", "Себестоимость", "Прибыль"),
                ("Un", "bag", 4, 600, 400, 200),
            ],
        )
        keeper = await self._staff("storekeeper")
        r = await keeper.get(
            f"{API}/reports/sales/export", params=params | {"by": "customer"}
        )
        rows = list(load_workbook(BytesIO(r.content)).active.values)
        self.assertEqual(
            rows, [("Клиент", "Заказы", "Продажи"), ("Baraka Market", 1, 600)]
        )
