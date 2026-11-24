import asyncio
import contextlib
import datetime as dt
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import httpx

from app.core.database import db_helper
from app.crud.debts import today
from app.crud.returns import ReturnManager
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone
from app.tests.test_onec import find, tag

API = "/api/v1"


@needs_db
class ReturnsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        self.c = httpx.AsyncClient(transport=transport, base_url="https://test")
        await self._post(
            "/auth/signup",
            {
                "company_name": "T",
                "name": "Owner",
                "login": random_phone(),
                "password": "secret-123",
            },
        )
        # the app's day (Tashkent), not the machine's: CI runs on UTC
        self.today = today()
        self.customer = await self._post("/customers", {"name": "Baraka"})
        self.flour = await self._post("/products", {"name": "Un", "unit": "bag"})
        self.oil = await self._post("/products", {"name": "Moy", "unit": "l"})
        self.wh = (await self._ok(await self.c.get(f"{API}/warehouses")))[0]["id"]
        await self._post("/vat-rates", {"rate": "12", "valid_from": "2020-01-01"})
        await self._post(
            "/stock-documents",
            {
                "kind": "receipt",
                "warehouse_id": self.wh,
                "lines": [
                    {"product_id": self.flour["id"], "quantity": "100"},
                    {"product_id": self.oil["id"], "quantity": "100"},
                ],
            },
        )
        # 10 bags at 1000 less 10%: 9000.00 with 964.29 VAT inside; 3 l at 333.33: 999.99
        self.order = await self._sale(
            [
                (self.flour["id"], "10", "1000", "10"),
                (self.oil["id"], "3", "333.33", "0"),
            ]
        )
        self.flour_line, self.oil_line = (ln["id"] for ln in self.order["lines"])

    async def asyncTearDown(self):
        await self.c.aclose()
        await db_helper.dispose()

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json() if r.content else None

    async def _post(self, path, body, code=201):
        return await self._ok(await self.c.post(f"{API}{path}", json=body), code)

    async def _get(self, path, **params):
        return await self._ok(await self.c.get(f"{API}{path}", params=params))

    async def _sale(self, lines, day=None):
        order = await self._post(
            "/orders",
            {
                "customer_id": self.customer["id"],
                "date": str(day or self.today),
                "lines": [
                    {"product_id": p, "quantity": q, "price": pr, "discount": d}
                    for p, q, pr, d in lines
                ],
            },
        )
        return await self._ok(await self.c.post(f"{API}/orders/{order['id']}/confirm"))

    async def _return(self, order_id, lines, code=201, **extra):
        return await self._post(
            f"/orders/{order_id}/returns",
            {
                "lines": [{"order_line_id": i, "quantity": q} for i, q in lines],
                **extra,
            },
            code,
        )

    async def _stock(self, product_id):
        rows = await self._get("/stock")
        return next(r["total"] for r in rows["items"] if r["product_id"] == product_id)

    async def _balance(self):
        rows = await self._get(f"/customers/{self.customer['id']}/balances")
        return rows[0]["balance"], rows[0]["overdue"]

    async def test_partial_returns_add_up_to_the_sale_and_restock(self):
        first = await self._return(self.order["id"], [(self.flour_line, "3")])
        self.assertEqual(
            (first["total"], first["vat_total"], first["order_number"]),
            ("2700.00", "289.29", self.order["number"]),
        )
        self.assertEqual(await self._stock(self.flour["id"]), "93.000")
        self.assertEqual(await self._balance(), ("7299.99", "0.00"))
        order = await self._get(f"/orders/{self.order['id']}")
        self.assertEqual(order["lines"][0]["returned"], "3.000")
        self.assertEqual(order["returned_total"], "2700.00")
        self.assertEqual(order["unpaid"], "7299.99")
        # the list knows the returned part too, so nobody mistakes it for a payment
        listed = (await self._get("/orders"))["items"][0]
        self.assertEqual(
            (listed["unpaid"], listed["returned_total"]), ("7299.99", "2700.00")
        )

        # the rest of the line: whatever is left of its amounts, so the two add up to the sale
        rest = await self._return(self.order["id"], [(self.flour_line, "7")])
        self.assertEqual((rest["total"], rest["vat_total"]), ("6300.00", "675.00"))
        await self._return(self.order["id"], [(self.flour_line, "0.001")], 422)

        # the akt sverki lists the returns on their own lines
        s = await self._get(
            f"/customers/{self.customer['id']}/statement", currency="UZS"
        )
        self.assertEqual(
            [(r["kind"], r["credit"]) for r in s["rows"] if r["kind"] == "return"],
            [("return", "2700.00"), ("return", "6300.00")],
        )
        self.assertEqual(s["closing"], "999.99")

        # the order can't be cancelled while its returns count: the goods would come back twice
        r = await self.c.post(f"{API}/orders/{self.order['id']}/cancel")
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "status"])

        undone = await self._ok(await self.c.post(f"{API}/returns/{rest['id']}/cancel"))
        self.assertTrue(undone["cancelled"])
        await self._ok(await self.c.post(f"{API}/returns/{rest['id']}/cancel"))
        self.assertEqual(await self._stock(self.flour["id"]), "93.000")
        self.assertEqual(await self._balance(), ("7299.99", "0.00"))

        moves = await self._get(f"/products/{self.flour['id']}/movements")
        self.assertEqual(
            [(m["kind"], m["number"]) for m in moves if m["kind"] == "return"],
            [("return", first["number"])],
        )
        timeline = await self._get("/activity", customer_id=self.customer["id"])
        self.assertEqual(
            [a["action"] for a in timeline if a["entity"] == "return"],
            ["cancelled", "created", "created"],
        )
        history = await self._get(
            "/activity", entity="order", entity_id=self.order["id"]
        )
        self.assertEqual(
            [(a["entity"], a["action"]) for a in history][:3],
            [("return", "cancelled"), ("return", "created"), ("return", "created")],
        )
        sales = (await self._get("/dashboard"))["sales"]
        self.assertEqual(sales["today"], "7299.99")  # 9999.99 sold, 2700 back

    async def test_a_return_lowers_its_own_order_not_the_oldest_debt(self):
        await self._ok(
            await self.c.patch(
                f"{API}/customers/{self.customer['id']}", json={"payment_days": 1}
            )
        )
        # an old sale, already late, and today's
        await self._sale(
            [(self.flour["id"], "1", "1000", "0")], self.today - dt.timedelta(days=10)
        )
        await self._return(self.order["id"], [(self.oil_line, "3")])
        # had the return paid the oldest debt first, the late 1000 would be gone
        self.assertEqual(await self._balance(), ("10000.00", "1000.00"))
        # paid in full, then more comes back: the customer is owed money
        await self._post(
            "/payments", {"customer_id": self.customer["id"], "amount": "10000"}
        )
        await self._return(self.order["id"], [(self.flour_line, "1")])
        self.assertEqual(await self._balance(), ("-900.00", "0.00"))

    async def test_two_returns_at_once_cant_both_take_the_rest(self):
        # each alone is allowed; together they'd bring back 20 of the 10 sold. To make the race
        # certain, each request waits after reading what's left until the other has read too
        # (at most half a second): without the order's lock both read 10 and both save
        read, together = [], asyncio.Event()
        original = ReturnManager.returned

        async def returned(manager, order_id):
            left = await original(manager, order_id)
            read.append(order_id)
            if len(read) == 2:
                together.set()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(together.wait(), 0.5)
            return left

        both = [
            self.c.post(
                f"{API}/orders/{self.order['id']}/returns",
                json={"lines": [{"order_line_id": self.flour_line, "quantity": "10"}]},
            )
            for _ in range(2)
        ]
        with patch.object(ReturnManager, "returned", returned):
            codes = sorted(r.status_code for r in await asyncio.gather(*both))
        self.assertEqual(codes, [201, 422])
        self.assertEqual(await self._stock(self.flour["id"]), "100.000")

    async def test_what_a_return_may_not_do(self):
        r = await self._return(
            self.order["id"],
            [(self.flour_line, "1")],
            422,
            date=str(self.today - dt.timedelta(days=1)),  # the order is today's
        )
        self.assertEqual(r["detail"][0]["loc"], ["body", "date"])
        r = await self._return(self.order["id"], [(self.flour_line, "11")], 422)
        self.assertEqual(r["detail"][0]["loc"], ["body", "lines"])
        other = await self._sale([(self.oil["id"], "1", "10", "0")])
        r = await self._return(self.order["id"], [(other["lines"][0]["id"], "1")], 422)
        self.assertEqual(r["detail"][0]["loc"], ["body", "lines"])
        draft = await self._post(
            "/orders",
            {
                "customer_id": self.customer["id"],
                "lines": [
                    {"product_id": self.oil["id"], "quantity": "1", "price": "1"}
                ],
            },
        )
        r = await self._return(draft["id"], [(draft["lines"][0]["id"], "1")], 422)
        self.assertEqual(r["detail"][0]["loc"], ["body", "order_id"])
        # unknown (or another company's) orders and returns are 404s
        await self._return(999999, [(self.flour_line, "1")], 404)
        for r in (
            await self.c.get(f"{API}/returns/999999"),
            await self.c.post(f"{API}/returns/999999/cancel"),
        ):
            self.assertEqual(r.status_code, 404)

    async def test_1c_gets_the_return_linked_to_its_sale(self):
        await self._ok(await self.c.patch(f"{API}/company", json={"inn": "305555555"}))
        ret = await self._return(self.order["id"], [(self.oil_line, "1")])
        r = await self.c.get(
            f"{API}/onec/export",
            params={"date_from": self.today, "date_to": self.today, "version": "1.4"},
        )
        body = ET.fromstring(r.content)[-1]
        self.assertEqual(
            [tag(d) for d in body],
            ["Документ.РеализацияТоваровУслуг", "Документ.ВозвратТоваровОтПокупателя"],
        )
        sale, back = body
        self.assertEqual(find(back, "КлючевыеСвойства/Номер").text, str(ret["number"]))
        self.assertEqual(
            find(back, "ДокументРеализации/РеализацияТоваровУслугСсылка/Ссылка").text,
            find(sale, "КлючевыеСвойства/Ссылка").text,
        )
        line = find(back, "Товары/Строка")
        self.assertEqual(
            (find(line, "Количество").text, find(line, "Сумма").text), ("1", "333.33")
        )


if __name__ == "__main__":
    unittest.main()
