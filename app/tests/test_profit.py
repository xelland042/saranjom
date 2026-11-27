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
class ProfitApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.today = clock.today()
        self.a = await self._company()
        self.main = next(w for w in await self._get("/warehouses") if w["is_default"])
        self.customer = await self._post("/customers", {"name": "Baraka Market"})
        self.flour = await self._post("/products", {"name": "Un", "unit": "bag"})
        self.sugar = await self._post("/products", {"name": "Shakar", "unit": "bag"})

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
                "name": "R",
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

    async def _post(self, path, body=None, code=201):
        return await self._ok(await self.a.post(f"{API}{path}", json=body), code)

    async def _get(self, path, code=200, client=None, **params):
        return await self._ok(
            await (client or self.a).get(f"{API}{path}", params=params), code
        )

    def _day(self, ago):
        return str(self.today - timedelta(days=ago))

    async def _receive(self, product, quantity, price, ago=20, **extra):
        return await self._post(
            "/stock-documents",
            {
                "kind": "receipt",
                "warehouse_id": self.main["id"],
                "currency": "UZS",
                "date": self._day(ago),
                "lines": [
                    {"product_id": product["id"], "quantity": quantity, "price": price}
                ],
                **extra,
            },
        )

    async def _sell(self, product, quantity, price, ago=5):
        order = await self._post(
            "/orders",
            {
                "customer_id": self.customer["id"],
                "date": self._day(ago),
                "lines": [
                    {"product_id": product["id"], "quantity": quantity, "price": price}
                ],
            },
        )
        return await self._post(f"/orders/{order['id']}/confirm", code=200)

    async def _spend(self, amount, category, kind="expense", ago=5, **extra):
        return await self._post(
            "/money-moves",
            {
                "kind": kind,
                "place": "cash",
                "currency": "UZS",
                "amount": amount,
                "category": category,
                "date": self._day(ago),
                **extra,
            },
        )

    async def _profit(self, ago_from=10, ago_to=0, **more):
        return await self._get(
            "/profit",
            date_from=self._day(ago_from),
            date_to=self._day(ago_to),
            **more,
        )

    async def test_profit_is_sales_less_the_goods_cost_less_expenses(self):
        await self._receive(self.flour, "10", "100")
        await self._sell(self.flour, "4", "150")
        await self._spend("50", "rent")
        await self._spend("30", "transport")
        await self._spend("20", "other", kind="income")
        # money that isn't earned or spent stays out
        await self._spend("1000", "opening", kind="income")
        await self._spend("70", "owner_out")
        await self._spend("40", "owner_in", kind="income")
        p = await self._profit()
        self.assertEqual(
            (p["sales"], p["cost"], p["gross"]), ("600.00", "400.00", "200.00")
        )
        self.assertEqual(
            p["expenses"],
            [
                {"category": "rent", "amount": "50.00"},
                {"category": "transport", "amount": "30.00"},
            ],
        )
        self.assertEqual(
            (p["expenses_total"], p["other_income"], p["profit"]),
            ("80.00", "20.00", "140.00"),
        )
        self.assertEqual(p["currency"], "UZS")
        self.assertEqual(p["uncosted"], {"count": 0, "sales": "0.00", "products": []})

    async def test_cost_is_the_average_of_what_was_paid_up_to_the_period_end(self):
        await self._receive(self.flour, "10", "100", ago=30)
        await self._receive(self.flour, "30", "200", ago=20)
        # after the period: next month's price doesn't change this one's profit
        await self._receive(self.flour, "100", "900", ago=1)
        # no price, a cancelled one: neither counts
        await self._receive(self.flour, "50", None, ago=25)
        wrong = await self._receive(self.flour, "50", "5", ago=25)
        await self._post(f"/stock-documents/{wrong['id']}/cancel", code=200)
        await self._sell(self.flour, "4", "300", ago=8)
        p = await self._profit(ago_from=10, ago_to=5)
        self.assertEqual((p["sales"], p["cost"]), ("1200.00", "700.00"))  # 4 x 175

    async def test_a_return_takes_back_its_sales_and_its_cost(self):
        await self._receive(self.flour, "10", "100")
        order = await self._sell(self.flour, "4", "150", ago=8)
        await self._post(
            f"/orders/{order['id']}/returns",
            {
                "lines": [{"order_line_id": order["lines"][0]["id"], "quantity": "1"}],
                "date": self._day(2),
            },
        )
        p = await self._profit()
        self.assertEqual(
            (p["sales"], p["cost"], p["profit"]), ("450.00", "300.00", "150.00")
        )
        # before the goods came back, the whole sale counts
        earlier = await self._profit(ago_from=10, ago_to=5)
        self.assertEqual((earlier["sales"], earlier["cost"]), ("600.00", "400.00"))

    async def test_goods_never_bought_at_a_price_are_named_not_hidden(self):
        await self._receive(self.flour, "10", "100")
        await self._receive(self.sugar, "10", None)
        await self._sell(self.flour, "1", "150")
        await self._sell(self.sugar, "2", "80")
        p = await self._profit()
        self.assertEqual((p["sales"], p["cost"]), ("310.00", "100.00"))
        self.assertEqual(
            p["uncosted"],
            {
                "count": 1,
                "sales": "160.00",
                "products": [
                    {"id": self.sugar["id"], "name": "Shakar", "sales": "160.00"}
                ],
            },
        )

    async def test_a_typed_cost_stands_in_where_no_price_was_entered(self):
        await self._receive(self.sugar, "10", None)
        await self._sell(self.sugar, "2", "80")
        self.assertEqual((await self._profit())["uncosted"]["count"], 1)
        r = await self.a.patch(
            f"{API}/products/{self.sugar['id']}", json={"cost": "50"}
        )
        self.assertEqual((await self._ok(r))["cost"], "50.00")
        p = await self._profit()
        self.assertEqual((p["cost"], p["uncosted"]["count"]), ("100.00", 0))
        # a priced delivery joins the unpriced one in the average: (10 x 50 + 10 x 70) / 20
        await self._receive(self.sugar, "10", "70")
        self.assertEqual((await self._profit())["cost"], "120.00")
        # one that never arrived (sold below zero) has its typed cost alone
        oil = await self._post("/products", {"name": "Yogʻ", "cost": "30"})
        await self._sell(oil, "3", "40")
        p = await self._profit()
        self.assertEqual((p["cost"], p["uncosted"]["count"]), ("210.00", 0))
        # the sales report counts the same way
        report = await self._get(
            "/reports/sales", date_from=self._day(10), date_to=self._day(0)
        )
        self.assertEqual((report["cost"], report["sales"]), (p["cost"], p["sales"]))
        # taken away again, the goods that came without a price are unknown again
        r = await self.a.patch(
            f"{API}/products/{self.sugar['id']}", json={"cost": None}
        )
        self.assertIsNone((await self._ok(r))["cost"])
        self.assertEqual((await self._profit())["cost"], "230.00")  # 2 x 70 + 3 x 30

    async def test_only_the_period_counts_and_cancelled_things_do_not(self):
        await self._receive(self.flour, "100", "100", ago=40)
        await self._sell(self.flour, "1", "150", ago=30)
        gone = await self._sell(self.flour, "5", "150", ago=5)
        await self._post(f"/orders/{gone['id']}/cancel", code=200)
        await self._spend("50", "rent", ago=30)
        wrong = await self._spend("999", "rent")
        await self._post(f"/money-moves/{wrong['id']}/cancel", code=200)
        p = await self._profit()
        self.assertEqual(
            (p["sales"], p["cost"], p["expenses"], p["profit"]),
            ("0.00", "0.00", [], "0.00"),
        )
        month = await self._profit(ago_from=35, ago_to=25)
        self.assertEqual(month["profit"], "0.00")  # 150 - 100 - 50
        self.assertEqual(month["sales"], "150.00")
        await self._get(
            "/profit", code=422, date_from=self._day(0), date_to=self._day(1)
        )

    async def test_other_currencies_count_at_the_saved_rate(self):
        await self._ok(
            await self.a.put(f"{API}/exchange-rates/USD", json={"rate": "12000"}), 204
        )
        supplier = await self._post("/suppliers", {"name": "Import"})
        await self._receive(
            self.flour, "10", "2", currency="USD", supplier_id=supplier["id"]
        )
        await self._sell(self.flour, "3", "30000")
        await self._spend("5", "transport", currency="USD")
        p = await self._profit()
        self.assertEqual(
            (p["sales"], p["cost"], p["expenses_total"], p["profit"]),
            ("90000.00", "72000.00", "60000.00", "-42000.00"),
        )

    async def test_it_needs_the_money_permission_and_stays_in_the_company(self):
        await self._receive(self.flour, "10", "100")
        await self._sell(self.flour, "4", "150")
        other = await self._company()
        self.addAsyncCleanup(other.aclose)
        theirs = await self._get(
            "/profit", client=other, date_from=self._day(10), date_to=self._day(0)
        )
        self.assertEqual((theirs["sales"], theirs["profit"]), ("0.00", "0.00"))
        roles = await self._get("/roles")
        role_id = next(
            r["id"] for r in roles if r["name"] == DEFAULT_ROLES["storekeeper"]["uz"]
        )
        login = random_phone()
        await self._post(
            "/staff",
            {
                "name": "Omborchi",
                "login": login,
                "password": "secret-456",
                "role_id": role_id,
            },
        )
        keeper = await self._client()
        self.addAsyncCleanup(keeper.aclose)
        await self._ok(
            await keeper.post(
                f"{API}/auth/login", json={"login": login, "password": "secret-456"}
            )
        )
        await self._get(
            "/profit",
            code=403,
            client=keeper,
            date_from=self._day(10),
            date_to=self._day(0),
        )
