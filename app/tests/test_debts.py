import random
import string
import unittest
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import httpx

import app.crud.rates as rates
from app.core.database import db_helper
from app.crud.debts import today
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class DebtsApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()
        self.customer = await self._ok(
            await self.a.post(
                f"{API}/customers", json={"name": "Baraka Market", "payment_days": 10}
            ),
            201,
        )
        self.product = await self._ok(
            await self.a.post(f"{API}/products", json={"name": "Un", "unit": "bag"}),
            201,
        )

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
                "name": "R",
                "login": random_phone(),
                "password": "secret-123",
            },
        )
        self.assertEqual(r.status_code, 201)
        return client

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    async def _sale(self, total, day: date, customer=None, **extra):
        body = {
            "customer_id": (customer or self.customer)["id"],
            "date": day.isoformat(),
            "lines": [
                {"product_id": self.product["id"], "quantity": "1", "price": total}
            ],
            **extra,
        }
        o = await self._ok(await self.a.post(f"{API}/orders", json=body), 201)
        return await self._ok(await self.a.post(f"{API}/orders/{o['id']}/confirm"))

    async def _pay(self, amount, code=201, **extra):
        body = {"customer_id": self.customer["id"], "amount": amount, **extra}
        return await self._ok(await self.a.post(f"{API}/payments", json=body), code)

    async def _debt(self, client=None, **params):
        page = await self._ok(
            await (client or self.a).get(f"{API}/debts", params=params)
        )
        return page

    async def test_payments_cover_the_oldest_debt_first(self):
        old = today() - timedelta(days=30)
        first = await self._sale("100", old)
        self.assertEqual(first["due_date"], (old + timedelta(days=10)).isoformat())
        await self._sale("50", today())  # due in 10 days: not late yet
        await self._pay("30")
        [d] = (await self._debt())["items"]
        self.assertEqual(
            (d["balance"], d["overdue"], d["late_since"]),
            ("120.00", "70.00", first["due_date"]),
        )
        await self._pay("80")
        [d] = (await self._debt())["items"]
        self.assertEqual(
            (d["balance"], d["overdue"], d["late_since"]), ("40.00", "0.00", None)
        )

    async def test_cancelled_payments_and_orders_stop_counting(self):
        o = await self._sale("100", today())
        p = await self._pay("100")
        self.assertEqual((await self._debt())["total"], 0)  # settled: not listed
        cancelled = await self._ok(
            await self.a.post(f"{API}/payments/{p['id']}/cancel")
        )
        self.assertIsNotNone(cancelled["cancelled_at"])
        self.assertEqual((await self._debt())["items"][0]["balance"], "100.00")
        await self._ok(await self.a.post(f"{API}/orders/{o['id']}/cancel"))
        self.assertEqual((await self._debt())["total"], 0)
        listed = await self._ok(await self.a.get(f"{API}/payments"))
        self.assertEqual(listed["total"], 1)  # still in the history

    async def test_opening_debt_and_statement(self):
        url = f"{API}/customers/{self.customer['id']}"
        r = await self.a.put(
            f"{url}/opening-balances/UZS",
            json={"amount": "500", "date": "2025-12-01"},
        )
        self.assertEqual(r.status_code, 204)
        await self._sale("200", date(2026, 1, 5))
        await self._pay("300", date="2026-01-10")
        s = await self._ok(
            await self.a.get(
                f"{url}/statement",
                params={
                    "currency": "UZS",
                    "date_from": "2026-01-01",
                    "date_to": "2026-01-31",
                },
            )
        )
        self.assertEqual(
            (s["opening"], s["debit"], s["credit"], s["closing"]),
            ("500.00", "200.00", "300.00", "400.00"),
        )
        self.assertEqual(
            [(x["kind"], x["balance"]) for x in s["rows"]],
            [("order", "700.00"), ("payment", "400.00")],
        )
        [b] = await self._ok(await self.a.get(f"{url}/balances"))
        self.assertEqual((b["balance"], b["opening"]["amount"]), ("400.00", "500.00"))

        # removed: the debt it added goes, the history says so, and a second removal is a 404
        r = await self.a.delete(f"{url}/opening-balances/UZS")
        self.assertEqual(r.status_code, 204)
        [b] = await self._ok(await self.a.get(f"{url}/balances"))
        self.assertEqual((b["balance"], b["opening"]), ("-100.00", None))
        self.assertEqual(
            (await self.a.delete(f"{url}/opening-balances/UZS")).status_code, 404
        )
        history = await self._ok(
            await self.a.get(
                f"{API}/activity", params={"customer_id": self.customer["id"]}
            )
        )
        self.assertIn("opening_deleted", [h["action"] for h in history])

    async def test_payment_list_filters_and_unknown_payments(self):
        await self._sale("1000", today())
        cash = await self._pay("100", date=(today() - timedelta(days=5)).isoformat())
        await self._pay("200", method="transfer")

        async def amounts(**params):
            page = await self._ok(await self.a.get(f"{API}/payments", params=params))
            return sorted(p["amount"] for p in page["items"])

        self.assertEqual(await amounts(method="transfer"), ["200.00"])
        yesterday = (today() - timedelta(days=1)).isoformat()
        self.assertEqual(await amounts(date_to=yesterday), ["100.00"])
        self.assertEqual(
            await amounts(customer_id=self.customer["id"]), ["100.00", "200.00"]
        )
        self.assertEqual((await self.a.get(f"{API}/payments/999999")).status_code, 404)
        self.assertEqual(
            (await self.a.post(f"{API}/payments/999999/cancel")).status_code, 404
        )
        # cancelling twice is harmless and logged once
        for _ in range(2):
            await self._ok(await self.a.post(f"{API}/payments/{cash['id']}/cancel"))
        history = await self._ok(
            await self.a.get(
                f"{API}/activity", params={"customer_id": self.customer["id"]}
            )
        )
        self.assertEqual(
            [h["action"] for h in history if h["entity"] == "payment"].count(
                "cancelled"
            ),
            1,
        )

    async def test_money_paid_ahead_is_a_negative_balance_left_out_of_totals(self):
        await self.a.put(
            f"{API}/customers/{self.customer['id']}/opening-balances/UZS",
            json={"amount": "-250", "date": "2025-12-01"},
        )
        other = await self._ok(
            await self.a.post(f"{API}/customers", json={"name": "Temir"}), 201
        )
        await self._sale("1000", today() - timedelta(days=3), customer=other)
        page = await self._debt()
        self.assertEqual(
            [(x["customer_name"], x["balance"]) for x in page["items"]],
            [("Temir", "1000.00"), ("Baraka Market", "-250.00")],
        )
        self.assertEqual(
            page["totals"],
            [{"currency": "UZS", "owed": "1000.00", "overdue": "1000.00"}],
        )
        late = await self._debt(overdue="true")
        self.assertEqual([x["customer_name"] for x in late["items"]], ["Temir"])
        found = await self._debt(q="темир")
        self.assertEqual(found["total"], 1)

    async def test_going_over_the_credit_limit_warns_but_confirms(self):
        await self._ok(
            await self.a.patch(
                f"{API}/customers/{self.customer['id']}",
                json={"credit_limit": "150", "credit_currency": "UZS"},
            )
        )
        first = await self._sale("100", today())
        self.assertIsNone(first["credit"])
        second = await self._sale("100", today())
        self.assertEqual(second["status"], "confirmed")
        self.assertEqual(
            second["credit"], {"currency": "UZS", "limit": "150.00", "debt": "200.00"}
        )

    async def test_payment_currency_and_rate(self):
        self.assertEqual((await self._pay("10"))["currency"], "UZS")
        code = "Q" + "".join(random.choices(string.ascii_uppercase, k=2))
        rates._last_try = None
        offline = AsyncMock(side_effect=httpx.ConnectError("offline"))
        with patch.object(rates, "fetch_cbu", offline):
            await self._pay("10", code=422, currency=code)
            await self.a.put(f"{API}/exchange-rates/{code}", json={"rate": "12850"})
            p = await self._pay("10", currency=code)
        self.assertEqual((p["currency"], p["exchange_rate"]), (code, "12850.000000"))

    async def test_bad_input_is_422(self):
        for body in [
            {"customer_id": self.customer["id"], "amount": "0"},
            {"customer_id": self.customer["id"], "amount": "5", "method": "barter"},
            {"customer_id": 999999999, "amount": "5"},
        ]:
            self.assertEqual(
                (await self.a.post(f"{API}/payments", json=body)).status_code, 422, body
            )
        url = f"{API}/customers/{self.customer['id']}"
        for patch_ in [{"payment_days": 400}, {"credit_limit": "5"}]:
            self.assertEqual((await self.a.patch(url, json=patch_)).status_code, 422)
        r = await self.a.put(
            f"{url}/opening-balances/UZS", json={"amount": "0", "date": "2025-01-01"}
        )
        self.assertEqual(r.status_code, 422)

    async def test_other_company_cannot_see_or_use(self):
        p = await self._pay("10")
        await self._sale("100", today())
        self.assertEqual((await self._debt(self.b))["total"], 0)
        self.assertEqual(
            (await self._ok(await self.b.get(f"{API}/payments")))["total"], 0
        )
        url = f"{API}/customers/{self.customer['id']}"
        for r in [
            await self.b.get(f"{API}/payments/{p['id']}"),
            await self.b.post(f"{API}/payments/{p['id']}/cancel"),
            await self.b.get(f"{url}/balances"),
            await self.b.get(f"{url}/statement", params={"currency": "UZS"}),
            await self.b.put(
                f"{url}/opening-balances/UZS",
                json={"amount": "1", "date": "2025-01-01"},
            ),
        ]:
            self.assertEqual(r.status_code, 404)
        r = await self.b.post(
            f"{API}/payments", json={"customer_id": self.customer["id"], "amount": "5"}
        )
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
