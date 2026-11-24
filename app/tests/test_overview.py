"""History, list filters and totals, Excel files, product movements and the dashboard."""

import random
import string
import unittest
from datetime import timedelta
from io import BytesIO
from unittest.mock import AsyncMock, patch

import httpx
from openpyxl import load_workbook

import app.crud.rates as rates
from app.core.database import db_helper
from app.crud.debts import today
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class OverviewApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()
        self.lists = await self._ok(await self.a.get(f"{API}/price-lists"))
        self.wh = (await self._ok(await self.a.get(f"{API}/warehouses")))[0]
        self.baraka = await self._post(
            "/customers", {"name": "Baraka", "payment_days": 10}
        )
        self.temir = await self._post("/customers", {"name": "Temir"})
        self.flour = await self._post(
            "/products", {"name": "Un", "unit": "bag", "min_stock": "20"}
        )
        self.oil = await self._post("/products", {"name": "Yog", "unit": "pcs"})

    async def asyncTearDown(self):
        await self.a.aclose()
        await self.b.aclose()
        await db_helper.dispose()

    async def _company(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        client = httpx.AsyncClient(transport=transport, base_url="https://test")
        r = await client.post(
            f"{API}/auth/signup",
            json={
                "company_name": "Test",
                "name": "Rustam",
                "login": random_phone(),
                "password": "secret-123",
            },
        )
        self.assertEqual(r.status_code, 201)
        return client

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    async def _post(self, path, body, code=201):
        return await self._ok(await self.a.post(f"{API}{path}", json=body), code)

    async def _get(self, path, **params):
        return await self._ok(await self.a.get(f"{API}{path}", params=params))

    async def _sale(
        self, customer, total, days_ago=0, confirm=True, product=None, **extra
    ):
        o = await self._post(
            "/orders",
            {
                "customer_id": customer["id"],
                "date": (today() - timedelta(days=days_ago)).isoformat(),
                "lines": [
                    {
                        "product_id": (product or self.flour)["id"],
                        "quantity": "1",
                        "price": total,
                    }
                ],
                **extra,
            },
        )
        if confirm:
            o = await self._ok(await self.a.post(f"{API}/orders/{o['id']}/confirm"))
        return o

    async def _sheet(self, path, **params):
        r = await self.a.get(f"{API}{path}", params=params)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("spreadsheetml", r.headers["content-type"])
        ws = load_workbook(BytesIO(r.content)).active
        return [[c.value for c in row] for row in ws.iter_rows()]

    # ---------- history ----------

    async def test_a_customers_timeline_gathers_their_records_and_notes(self):
        cid = self.baraka["id"]
        await self.a.patch(f"{API}/customers/{cid}", json={"phone": "+998901112233"})
        order = await self._sale(self.baraka, "100")
        await self._post("/payments", {"customer_id": cid, "amount": "40"})
        await self._post("/tasks", {"title": "call", "customer_id": cid})
        note = await self._post(f"/customers/{cid}/notes", {"text": "promised Friday"})
        self.assertTrue(note["mine"])
        feed = await self._get("/activity", customer_id=cid)
        self.assertEqual(
            [(x["entity"], x["action"]) for x in feed],
            [
                ("customer", "note"),
                ("task", "created"),
                ("payment", "created"),
                ("order", "confirmed"),
                ("order", "created"),
                ("customer", "updated"),
                ("customer", "created"),
            ],
        )
        self.assertEqual(feed[5]["data"]["changes"], {"phone": [None, "+998901112233"]})
        self.assertEqual(feed[3]["data"]["total"], "100.00")
        self.assertEqual(feed[0]["user_name"], "Rustam")
        # one record's own history
        history = await self._get("/activity", entity="order", entity_id=order["id"])
        self.assertEqual([x["action"] for x in history], ["confirmed", "created"])
        # paging back
        older = await self._get("/activity", customer_id=cid, before=feed[1]["id"])
        self.assertEqual(older[0]["id"], feed[2]["id"])
        # only notes can be deleted; the rest is history
        self.assertEqual(
            (await self.a.delete(f"{API}/activity/{feed[1]['id']}")).status_code, 404
        )
        self.assertEqual(
            (await self.a.delete(f"{API}/activity/{note['id']}")).status_code, 204
        )

    async def test_history_is_per_company(self):
        cid = self.baraka["id"]
        note = await self._post(f"/customers/{cid}/notes", {"text": "secret"})
        self.assertEqual(
            await self._ok(
                await self.b.get(f"{API}/activity", params={"customer_id": cid})
            ),
            [],
        )
        r = await self.b.post(f"{API}/customers/{cid}/notes", json={"text": "x"})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(
            (await self.b.delete(f"{API}/activity/{note['id']}")).status_code, 404
        )
        self.assertEqual(
            (
                await self.a.post(f"{API}/customers/{cid}/notes", json={"text": " "})
            ).status_code,
            422,
        )

    # ---------- lists ----------

    async def test_orders_filter_by_date_and_payment_with_totals(self):
        old = await self._sale(self.baraka, "100", days_ago=30)  # due 20 days ago
        mid = await self._sale(self.baraka, "50", days_ago=5)  # due in 5 days
        await self._sale(
            self.temir, "70", days_ago=1
        )  # no payment days: late since yesterday
        await self._sale(self.temir, "999", confirm=False)  # a draft: in no total
        await self._post(
            "/payments", {"customer_id": self.baraka["id"], "amount": "120"}
        )
        page = await self._get("/orders")
        self.assertEqual(page["total"], 4)
        self.assertEqual(
            page["sums"], [{"currency": "UZS", "total": "220.00", "unpaid": "100.00"}]
        )
        by_id = {o["id"]: o for o in page["items"]}
        # the oldest is paid first: 100 of it, then 20 of the next
        self.assertEqual(
            (by_id[old["id"]]["unpaid"], by_id[mid["id"]]["unpaid"]), ("0.00", "30.00")
        )
        unpaid = await self._get("/orders", payment="unpaid")
        self.assertEqual(
            {o["customer_name"] for o in unpaid["items"]}, {"Baraka", "Temir"}
        )
        late = await self._get("/orders", payment="overdue")
        self.assertEqual([o["customer_name"] for o in late["items"]], ["Temir"])
        recent = await self._get(
            "/orders", date_from=(today() - timedelta(days=7)).isoformat()
        )
        self.assertEqual(recent["total"], 3)
        biggest = await self._get("/orders", sort="-total")
        self.assertEqual(biggest["items"][0]["total"], "999.00")
        one = await self._get(f"/orders/{mid['id']}")
        self.assertEqual((one["unpaid"], one["due_date"]), ("30.00", mid["due_date"]))
        self.assertEqual(
            (await self.a.get(f"{API}/orders", params={"sort": "x"})).status_code, 422
        )

    async def test_payments_filters_and_totals(self):
        for amount, method in [("10", "cash"), ("20", "card"), ("30", "cash")]:
            p = await self._post(
                "/payments",
                {"customer_id": self.baraka["id"], "amount": amount, "method": method},
            )
        await self.a.post(f"{API}/payments/{p['id']}/cancel")
        page = await self._get("/payments")
        self.assertEqual(page["sums"], [{"currency": "UZS", "amount": "30.00"}])
        cash = await self._get("/payments", method="cash", sort="amount")
        self.assertEqual([x["amount"] for x in cash["items"]], ["10.00", "30.00"])

    async def test_customers_show_debt_and_last_order(self):
        await self._sale(self.baraka, "100", days_ago=3)
        page = await self._get("/customers", sort="-last_order")
        first = page["items"][0]
        self.assertEqual(first["name"], "Baraka")
        self.assertEqual(first["last_order"], (today() - timedelta(days=3)).isoformat())
        self.assertEqual(
            first["balances"],
            [{"currency": "UZS", "balance": "100.00", "overdue": "0.00"}],
        )
        self.assertEqual(
            (page["items"][1]["name"], page["items"][1]["balances"]), ("Temir", [])
        )

    async def test_products_show_stock_and_running_low(self):
        await self._post(
            "/stock-documents",
            {
                "kind": "receipt",
                "warehouse_id": self.wh["id"],
                "lines": [
                    {"product_id": self.flour["id"], "quantity": "25"},
                    {"product_id": self.oil["id"], "quantity": "5"},
                ],
            },
        )
        await self._sale(self.temir, "1", product=self.flour)
        page = await self._get("/products", sort="-stock")
        self.assertEqual(
            [(p["name"], p["stock"], p["low"]) for p in page["items"]],
            [("Un", "24.000", False), ("Yog", "5.000", False)],
        )
        await self._post(
            "/stock-documents",
            {
                "kind": "write_off",
                "warehouse_id": self.wh["id"],
                "lines": [{"product_id": self.flour["id"], "quantity": "10"}],
            },
        )
        low = await self._get("/stock", show="low")
        self.assertEqual([x["name"] for x in low["items"]], ["Un"])
        moves = await self._get(f"/products/{self.flour['id']}/movements")
        self.assertEqual([m["kind"] for m in moves], ["write_off", "sale", "receipt"])
        self.assertEqual(moves[1]["customer_name"], "Temir")
        r = await self.b.get(f"{API}/products/{self.flour['id']}/movements")
        self.assertEqual(r.status_code, 404)

    # ---------- Excel ----------

    async def test_excel_files_hold_numbers_and_the_chosen_language(self):
        await self._sale(self.baraka, "385000", days_ago=2)
        await self._post(
            "/payments", {"customer_id": self.baraka["id"], "amount": "1000"}
        )
        rows = await self._sheet("/orders/export", lang="ru")
        self.assertEqual(rows[0][:3], ["№", "Дата", "Клиент"])
        self.assertEqual(
            (rows[1][2], rows[1][3], rows[1][4]), ("Baraka", "Подтверждён", 385000)
        )
        pay = await self._sheet("/payments/export")
        self.assertEqual((pay[1][3], pay[1][5]), (1000, "Naqd"))
        debts = await self._sheet("/debts/export", lang="uz-Cyrl")
        self.assertEqual((debts[0][0], debts[1][1]), ("Мижоз", 384000))
        self.assertEqual(len(await self._sheet("/customers/export")), 3)
        products = await self._sheet("/products/export")
        self.assertIn("Asosiy narx, UZS", products[0][-1])
        stock = await self._sheet("/stock/export")
        self.assertEqual(stock[0][0], "Mahsulot")
        # another company's filters see nothing of ours
        r = await self.b.get(f"{API}/orders/export")
        self.assertEqual(
            len(list(load_workbook(BytesIO(r.content)).active.iter_rows())), 1
        )

    # ---------- dashboard ----------

    async def test_dashboard_adds_up_in_the_companys_currency(self):
        code = "Q" + "".join(random.choices(string.ascii_uppercase, k=2))
        foreign = await self._post("/price-lists", {"name": "Diler", "currency": code})
        rates._last_try = None
        with patch.object(
            rates, "fetch_cbu", AsyncMock(side_effect=httpx.ConnectError("x"))
        ):
            await self.a.put(f"{API}/exchange-rates/{code}", json={"rate": "12000"})
            await self._sale(self.temir, "10", price_list_id=foreign["id"])  # 120 000
        await self._sale(self.baraka, "30000")
        await self._sale(
            self.baraka, "50000", days_ago=40
        )  # last month at most: not in today's
        await self._sale(self.baraka, "1", confirm=False)
        await self._post(
            "/payments", {"customer_id": self.baraka["id"], "amount": "20000"}
        )
        await self._post(
            "/tasks",
            {"title": "late", "due_date": (today() - timedelta(days=1)).isoformat()},
        )
        await self._post(
            "/tasks",
            {"title": "later", "due_date": (today() + timedelta(days=3)).isoformat()},
        )
        d = await self._get("/dashboard")
        self.assertEqual(d["currency"], "UZS")
        self.assertEqual(
            (d["sales"]["today"], d["sales"]["orders_today"], d["sales"]["drafts"]),
            ("150000.00", 2, 1),
        )
        self.assertEqual(d["received"]["today"], "20000.00")
        self.assertEqual(len(d["daily"]), 30)
        self.assertEqual(
            d["daily"][-1], {"date": today().isoformat(), "total": "150000.00"}
        )
        self.assertEqual(d["debts"]["top"][0]["customer_name"], "Baraka")
        self.assertEqual(d["debts"]["overdue_customers"], 1)
        self.assertEqual([t["title"] for t in d["tasks"]["items"]], ["late"])
        # sold flour without receiving it: below zero, and below its minimum of 20
        self.assertEqual(
            (d["stock"]["negative"], d["stock"]["items"][0]["name"]), (1, "Un")
        )
        self.assertEqual(len(d["recent"]), 4)
        empty = await self._ok(await self.b.get(f"{API}/dashboard"))
        self.assertEqual((empty["sales"]["today"], empty["recent"]), ("0.00", []))


if __name__ == "__main__":
    unittest.main()
