import unittest

import httpx

from app.core.database import db_helper
from app.core.permissions import DEFAULT_ROLES
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class PurchasingApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()
        self.main = next(
            w
            for w in await self._ok(await self.a.get(f"{API}/warehouses"))
            if w["is_default"]
        )
        self.flour = await self._product("Un 50 kg")
        self.sugar = await self._product("Shakar")
        self.mill = await self._supplier(name="Tegirmon MChJ", inn="301234567")

    async def asyncTearDown(self):
        await self.a.aclose()
        await self.b.aclose()
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

    async def _product(self, name):
        return await self._ok(
            await self.a.post(f"{API}/products", json={"name": name, "unit": "bag"}),
            201,
        )

    async def _supplier(self, client=None, code=201, **body):
        return await self._ok(
            await (client or self.a).post(f"{API}/suppliers", json=body), code
        )

    async def _buy(self, lines, code=201, client=None, **extra):
        """A receipt from the mill: lines are (product, quantity, price)."""
        body = {
            "kind": "receipt",
            "warehouse_id": self.main["id"],
            "supplier_id": self.mill["id"],
            "currency": "UZS",
            "lines": [
                {"product_id": p["id"], "quantity": q, "price": price}
                for p, q, price in lines
            ],
            **extra,
        }
        return await self._ok(
            await (client or self.a).post(f"{API}/stock-documents", json=body), code
        )

    async def _pay(self, amount, code=201, **extra):
        body = {
            "supplier_id": self.mill["id"],
            "amount": amount,
            "currency": "UZS",
            **extra,
        }
        return await self._ok(
            await self.a.post(f"{API}/supplier-payments", json=body), code
        )

    async def _owed(self, supplier=None):
        s = await self._ok(
            await self.a.get(f"{API}/suppliers/{(supplier or self.mill)['id']}")
        )
        return {b["currency"]: b["owed"] for b in s["balances"]}

    # ---------- suppliers ----------

    async def test_a_supplier_is_found_in_any_script_and_its_inn_is_unique(self):
        page = await self._ok(
            await self.a.get(f"{API}/suppliers", params={"q": "тегирмон"})
        )
        self.assertEqual([s["name"] for s in page["items"]], ["Tegirmon MChJ"])
        r = await self.a.post(
            f"{API}/suppliers", json={"name": "Boshqa", "inn": "301234567"}
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["id"], self.mill["id"])
        # the same ИНН is free in another company, and as one of our customers
        await self._supplier(self.b, name="Tegirmon", inn="301234567")
        await self._ok(
            await self.a.post(
                f"{API}/customers", json={"name": "Tegirmon", "inn": "301234567"}
            ),
            201,
        )

    async def test_an_archived_supplier_leaves_the_list_and_takes_no_new_purchase(self):
        await self._ok(
            await self.a.patch(
                f"{API}/suppliers/{self.mill['id']}", json={"archived": True}
            )
        )
        self.assertEqual(
            (await self._ok(await self.a.get(f"{API}/suppliers")))["items"], []
        )
        archived = await self._ok(
            await self.a.get(f"{API}/suppliers", params={"archived": True})
        )
        self.assertEqual(len(archived["items"]), 1)
        await self._buy([(self.flour, "1", "100")], code=422)

    async def test_another_company_never_sees_or_uses_our_supplier(self):
        self.assertEqual(
            (await self.b.get(f"{API}/suppliers/{self.mill['id']}")).status_code, 404
        )
        self.assertEqual(
            (
                await self.b.patch(
                    f"{API}/suppliers/{self.mill['id']}", json={"name": "X"}
                )
            ).status_code,
            404,
        )
        r = await self.b.post(
            f"{API}/supplier-payments",
            json={"supplier_id": self.mill["id"], "amount": "1", "currency": "UZS"},
        )
        self.assertEqual(r.status_code, 422)

    # ---------- purchases ----------

    async def test_a_purchase_adds_stock_and_what_we_owe_its_total(self):
        doc = await self._buy(
            [(self.flour, "10", "185000"), (self.sugar, "2.5", "33333.33")]
        )
        # each line rounded by itself: 1 850 000 + 83 333.33 (83 333.325 rounds up)
        self.assertEqual(doc["total"], "1933333.33")
        self.assertEqual(doc["supplier_name"], "Tegirmon MChJ")
        self.assertEqual(doc["exchange_rate"], None)
        self.assertEqual(await self._owed(), {"UZS": "1933333.33"})
        stock = await self._ok(await self.a.get(f"{API}/stock"))
        self.assertEqual(
            {r["name"]: r["total"] for r in stock["items"]},
            {"Un 50 kg": "10.000", "Shakar": "2.500"},
        )
        listed = await self._ok(
            await self.a.get(
                f"{API}/stock-documents", params={"supplier_id": self.mill["id"]}
            )
        )
        self.assertEqual(
            [(d["number"], d["total"], d["supplier_name"]) for d in listed["items"]],
            [(doc["number"], "1933333.33", "Tegirmon MChJ")],
        )

    async def test_a_purchase_needs_a_price_on_every_line_and_is_only_a_receipt(self):
        r = await self._buy(
            [(self.flour, "1", "100"), (self.sugar, "1", None)], code=422
        )
        self.assertEqual(r["detail"][0]["loc"][-1], "lines")
        body = {
            "kind": "write_off",
            "warehouse_id": self.main["id"],
            "supplier_id": self.mill["id"],
            "lines": [{"product_id": self.flour["id"], "quantity": "1"}],
        }
        r = await self.a.post(f"{API}/stock-documents", json=body)
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"][0]["loc"][-1], "supplier_id")
        self.assertEqual(await self._owed(), {})

    async def test_a_receipt_without_a_supplier_owes_nobody(self):
        body = {
            "kind": "receipt",
            "warehouse_id": self.main["id"],
            "currency": "UZS",
            "lines": [{"product_id": self.flour["id"], "quantity": "3", "price": "10"}],
        }
        doc = await self._ok(
            await self.a.post(f"{API}/stock-documents", json=body), 201
        )
        self.assertEqual((doc["supplier_id"], doc["total"]), (None, "30.00"))
        page = await self._ok(await self.a.get(f"{API}/suppliers"))
        self.assertEqual(page["owed"], [])

    async def test_cancelling_a_purchase_takes_back_the_stock_and_the_debt(self):
        doc = await self._buy([(self.flour, "10", "100")])
        await self._ok(await self.a.post(f"{API}/stock-documents/{doc['id']}/cancel"))
        self.assertEqual(await self._owed(), {})
        stock = await self._ok(await self.a.get(f"{API}/stock"))
        self.assertEqual({r["total"] for r in stock["items"]}, {"0.000"})

    async def test_a_foreign_purchase_saves_its_rate_and_is_refused_without_one(self):
        r = await self._buy([(self.flour, "1", "50")], code=422, currency="USD")
        self.assertEqual(r["detail"][0]["loc"][-1], "exchange_rate")
        await self._ok(
            await self.a.put(f"{API}/exchange-rates/USD", json={"rate": "12850"}), 204
        )
        doc = await self._buy([(self.flour, "1", "50")], currency="USD")
        self.assertEqual(doc["exchange_rate"], "12850.000000")
        payment = await self._pay("20", currency="USD")
        self.assertEqual(payment["exchange_rate"], "12850.000000")
        self.assertEqual(await self._owed(), {"USD": "30.00"})

    # ---------- paying ----------

    async def test_payments_lower_what_we_owe_and_a_cancelled_one_stops_counting(self):
        await self._buy([(self.flour, "10", "100")])
        first = await self._pay("400", method="transfer", note="1-qism")
        self.assertEqual(
            (first["number"], first["supplier_name"]), (1, "Tegirmon MChJ")
        )
        second = await self._pay("700")
        self.assertEqual(second["number"], 2)
        # paid 100 ahead
        self.assertEqual(await self._owed(), {"UZS": "-100.00"})
        cancelled = await self._ok(
            await self.a.post(f"{API}/supplier-payments/{second['id']}/cancel")
        )
        self.assertIsNotNone(cancelled["cancelled_at"])
        self.assertEqual(await self._owed(), {"UZS": "600.00"})
        page = await self._ok(
            await self.a.get(
                f"{API}/supplier-payments", params={"supplier_id": self.mill["id"]}
            )
        )
        self.assertEqual(page["total"], 2)
        self.assertEqual(page["sums"], [{"currency": "UZS", "amount": "400.00"}])
        self.assertEqual(
            (await self.a.post(f"{API}/supplier-payments/999999/cancel")).status_code,
            404,
        )
        self.assertEqual(
            (await self.b.get(f"{API}/supplier-payments/{first['id']}")).status_code,
            404,
        )

    async def test_the_list_can_show_only_those_we_owe_with_the_sum_over_all(self):
        other = await self._supplier(name="Shakar zavodi")
        await self._supplier(name="Hech narsa olmaganmiz")
        await self._buy([(self.flour, "10", "100")])
        await self._buy([(self.sugar, "1", "250")], supplier_id=other["id"])
        await self._pay("1500")  # the mill is paid 500 ahead
        page = await self._ok(
            await self.a.get(f"{API}/suppliers", params={"owed": True})
        )
        self.assertEqual([s["name"] for s in page["items"]], ["Shakar zavodi"])
        # one supplier's advance doesn't pay another's bill
        self.assertEqual(page["owed"], [{"currency": "UZS", "owed": "250.00"}])
        self.assertEqual(await self._owed(other), {"UZS": "250.00"})

    async def test_changes_are_written_to_the_history(self):
        await self._ok(
            await self.a.patch(
                f"{API}/suppliers/{self.mill['id']}", json={"phone": "+998901112233"}
            )
        )
        feed = await self._ok(
            await self.a.get(
                f"{API}/activity",
                params={"entity": "supplier", "entity_id": self.mill["id"]},
            )
        )
        self.assertEqual([a["action"] for a in feed], ["updated", "created"])
        self.assertEqual(feed[0]["data"]["changes"], {"phone": [None, "+998901112233"]})
        payment = await self._pay("5")
        feed = await self._ok(
            await self.a.get(
                f"{API}/activity",
                params={"entity": "supplier_payment", "entity_id": payment["id"]},
            )
        )
        self.assertEqual(feed[0]["data"]["supplier_id"], self.mill["id"])

    async def test_the_payments_excel_file_downloads(self):
        await self._pay("5")
        r = await self.a.get(f"{API}/supplier-payments/export", params={"lang": "ru"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content.startswith(b"PK"))

    # ---------- who may ----------

    async def test_a_storekeeper_enters_purchases_but_sees_no_money(self):
        await self._buy([(self.flour, "10", "100")])
        roles = await self._ok(await self.a.get(f"{API}/roles"))
        role_id = next(
            r["id"] for r in roles if r["name"] == DEFAULT_ROLES["storekeeper"]["uz"]
        )
        login = random_phone()
        await self._ok(
            await self.a.post(
                f"{API}/staff",
                json={
                    "name": "Omborchi",
                    "login": login,
                    "password": "secret-456",
                    "role_id": role_id,
                },
            ),
            201,
        )
        keeper = await self._client()
        self.addAsyncCleanup(keeper.aclose)
        await self._ok(
            await keeper.post(
                f"{API}/auth/login", json={"login": login, "password": "secret-456"}
            )
        )
        await self._supplier(keeper, name="Yangi yetkazib beruvchi")
        await self._buy([(self.flour, "1", "100")], client=keeper)
        page = await self._ok(await keeper.get(f"{API}/suppliers"))
        self.assertEqual(page["owed"], [])
        self.assertEqual({tuple(s["balances"]) for s in page["items"]}, {()})
        for method, path in (
            ("GET", "/suppliers?owed=true"),
            ("GET", "/supplier-payments"),
            ("POST", "/supplier-payments"),
        ):
            r = await keeper.request(method, f"{API}{path}", json={})
            self.assertEqual(r.status_code, 403, path)
