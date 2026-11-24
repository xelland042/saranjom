import random
import string
import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx

import app.crud.rates as rates
from app.core.database import db_helper
from app.crud.orders import line_amounts
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


class LineAmountsTest(unittest.TestCase):
    def test_discount_then_vat_inside_the_price(self):
        amount, vat = line_amounts(
            Decimal("10"), Decimal("12000"), Decimal("5"), Decimal("12")
        )
        self.assertEqual((amount, vat), (Decimal("114000.00"), Decimal("12214.29")))

    def test_no_vat_and_fractional_quantities_round_half_up(self):
        amount, vat = line_amounts(
            Decimal("2.5"), Decimal("0.05"), Decimal("0"), Decimal("0")
        )
        self.assertEqual((amount, vat), (Decimal("0.13"), Decimal("0.00")))


@needs_db
class OrdersApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()
        lists = await self._ok(await self.a.get(f"{API}/price-lists"))
        self.main_list = lists[0]
        self.customer = await self._ok(
            await self.a.post(f"{API}/customers", json={"name": "Baraka Market"}), 201
        )
        self.flour = await self._ok(
            await self.a.post(
                f"{API}/products",
                json={
                    "name": "Un 50 kg",
                    "unit": "bag",
                    "prices": [
                        {"price_list_id": self.main_list["id"], "amount": "385000"}
                    ],
                },
            ),
            201,
        )
        warehouses = await self._ok(await self.a.get(f"{API}/warehouses"))
        self.warehouse = warehouses[0]

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

    async def _order(self, quantity="10", price="385000", code=201, **extra):
        body = {
            "customer_id": self.customer["id"],
            "lines": [
                {"product_id": self.flour["id"], "quantity": quantity, "price": price}
            ],
            **extra,
        }
        return await self._ok(await self.a.post(f"{API}/orders", json=body), code)

    async def _stock(self):
        page = await self._ok(await self.a.get(f"{API}/stock"))
        return page["items"][0]["total"]

    async def _receive(self, quantity):
        await self._ok(
            await self.a.post(
                f"{API}/stock-documents",
                json={
                    "kind": "receipt",
                    "warehouse_id": self.warehouse["id"],
                    "lines": [{"product_id": self.flour["id"], "quantity": quantity}],
                },
            ),
            201,
        )

    async def test_draft_takes_defaults_and_counts_totals(self):
        o = await self._order(quantity="2")
        self.assertEqual(
            (
                o["status"],
                o["number"],
                o["currency"],
                o["warehouse_id"],
                o["customer_name"],
            ),
            ("draft", 1, "UZS", self.warehouse["id"], "Baraka Market"),
        )
        self.assertEqual((o["total"], o["vat_total"]), ("770000.00", "0.00"))
        second = await self._order()
        self.assertEqual(second["number"], 2)

    async def test_vat_follows_the_rate_valid_on_the_order_date(self):
        await self._ok(
            await self.a.post(
                f"{API}/vat-rates", json={"rate": "12", "valid_from": "2026-01-01"}
            ),
            201,
        )
        before = await self._order(quantity="1", price="112000", date="2025-12-31")
        after = await self._order(quantity="1", price="112000", date="2026-01-02")
        self.assertEqual(before["vat_total"], "0.00")
        self.assertEqual(
            (after["vat_total"], after["lines"][0]["vat_rate"]), ("12000.00", "12.00")
        )
        dup = await self.a.post(
            f"{API}/vat-rates", json={"rate": "15", "valid_from": "2026-01-01"}
        )
        self.assertEqual(dup.status_code, 409)

    async def test_only_confirmed_orders_take_stock_and_cancelling_returns_it(self):
        await self._receive("100")
        o = await self._order(quantity="30")
        self.assertEqual(await self._stock(), "100.000")
        url = f"{API}/orders/{o['id']}"
        confirmed = await self._ok(await self.a.post(f"{url}/confirm"))
        self.assertEqual(
            (confirmed["status"], confirmed["negative"]), ("confirmed", [])
        )
        self.assertIsNotNone(confirmed["confirmed_at"])
        self.assertEqual(await self._stock(), "70.000")
        await self._ok(await self.a.post(f"{url}/cancel"))
        self.assertEqual(await self._stock(), "100.000")

    async def test_selling_beyond_stock_is_allowed_and_reported(self):
        await self._receive("5")
        o = await self._order(quantity="8")
        r = await self._ok(await self.a.post(f"{API}/orders/{o['id']}/confirm"))
        self.assertEqual(r["negative"][0]["quantity"], "-3.000")

    async def test_only_drafts_change(self):
        o = await self._order()
        url = f"{API}/orders/{o['id']}"
        body = {
            "customer_id": self.customer["id"],
            "lines": [
                {
                    "product_id": self.flour["id"],
                    "quantity": "3",
                    "price": "380000",
                    "discount": "10",
                }
            ],
        }
        replaced = await self._ok(await self.a.put(url, json=body))
        self.assertEqual((len(replaced["lines"]), replaced["total"]), (1, "1026000.00"))
        await self._ok(await self.a.post(f"{url}/confirm"))
        self.assertEqual((await self.a.put(url, json=body)).status_code, 422)
        self.assertEqual((await self.a.post(f"{url}/confirm")).status_code, 422)

    async def test_an_empty_draft_can_be_saved_but_not_confirmed(self):
        o = await self._ok(
            await self.a.post(
                f"{API}/orders", json={"customer_id": self.customer["id"]}
            ),
            201,
        )
        r = await self.a.post(f"{API}/orders/{o['id']}/confirm")
        self.assertEqual(r.status_code, 422)

    async def test_foreign_currency_saves_the_rate_at_confirmation(self):
        # a made-up currency: the official rate table is shared, and may hold today's real USD
        code = "Q" + "".join(random.choices(string.ascii_uppercase, k=2))
        foreign = await self._ok(
            await self.a.post(
                f"{API}/price-lists", json={"name": "Diler", "currency": code}
            ),
            201,
        )
        rates._last_try = None
        offline = AsyncMock(side_effect=httpx.ConnectError("offline"))
        with patch.object(rates, "fetch_cbu", offline):
            o = await self._order(price="30", price_list_id=foreign["id"])
            self.assertEqual(o["currency"], code)
            r = await self.a.post(f"{API}/orders/{o['id']}/confirm")
            # no official rate and no own rate: refuse rather than guess
            self.assertEqual(r.status_code, 422)
            await self.a.put(f"{API}/exchange-rates/{code}", json={"rate": "12850"})
            r = await self._ok(await self.a.post(f"{API}/orders/{o['id']}/confirm"))
        self.assertEqual(r["exchange_rate"], "12850.000000")

    async def test_customer_price_list_is_used_when_none_is_given(self):
        usd = await self._ok(
            await self.a.post(
                f"{API}/price-lists", json={"name": "Diler", "currency": "USD"}
            ),
            201,
        )
        await self._ok(
            await self.a.patch(
                f"{API}/customers/{self.customer['id']}",
                json={"price_list_id": usd["id"]},
            )
        )
        o = await self._order(price="30")
        self.assertEqual((o["price_list_id"], o["currency"]), (usd["id"], "USD"))

    async def test_list_filters(self):
        other = await self._ok(
            await self.a.post(f"{API}/customers", json={"name": "Temir Beton"}), 201
        )
        draft = await self._order()
        await self._order(customer_id=other["id"])
        await self._ok(await self.a.post(f"{API}/orders/{draft['id']}/confirm"))
        page = await self._ok(await self.a.get(f"{API}/orders"))
        self.assertEqual(page["total"], 2)
        by_status = await self._ok(
            await self.a.get(f"{API}/orders", params={"status": "confirmed"})
        )
        self.assertEqual([x["id"] for x in by_status["items"]], [draft["id"]])
        by_name = await self._ok(
            await self.a.get(f"{API}/orders", params={"q": "темир"})
        )
        self.assertEqual(
            [x["customer_name"] for x in by_name["items"]], ["Temir Beton"]
        )
        by_customer = await self._ok(
            await self.a.get(f"{API}/orders", params={"customer_id": other["id"]})
        )
        self.assertEqual(by_customer["total"], 1)

    async def test_bad_orders_are_422(self):
        archived = await self._ok(
            await self.a.post(f"{API}/customers", json={"name": "Eski"}), 201
        )
        await self.a.patch(f"{API}/customers/{archived['id']}", json={"archived": True})
        line = {"product_id": self.flour["id"], "quantity": "1", "price": "1"}
        for body in [
            {"customer_id": archived["id"], "lines": [line]},
            {
                "customer_id": self.customer["id"],
                "lines": [{**line, "discount": "101"}],
            },
            {"customer_id": self.customer["id"], "lines": [{**line, "quantity": "0"}]},
            {"customer_id": self.customer["id"], "lines": [{**line, "price": "-1"}]},
            {
                "customer_id": self.customer["id"],
                "lines": [{**line, "product_id": 999999999}],
            },
        ]:
            r = await self.a.post(f"{API}/orders", json=body)
            self.assertEqual(r.status_code, 422, body)

    async def test_other_company_cannot_see_or_use(self):
        o = await self._order()
        url = f"{API}/orders/{o['id']}"
        self.assertEqual(
            (await self._ok(await self.b.get(f"{API}/orders")))["total"], 0
        )
        for r in [
            await self.b.get(url),
            await self.b.post(f"{url}/confirm"),
            await self.b.post(f"{url}/cancel"),
        ]:
            self.assertEqual(r.status_code, 404)
        r = await self.b.post(
            f"{API}/orders", json={"customer_id": self.customer["id"], "lines": []}
        )
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
