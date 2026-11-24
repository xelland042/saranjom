import asyncio
import unittest

import httpx

from app.core.database import db_helper
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class StockApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company("ru")
        self.b = await self._company()
        self.main = await self._default_warehouse(self.a)
        self.shop = await self._ok(
            await self.a.post(f"{API}/warehouses", json={"name": "Doʻkon"}), 201
        )
        self.flour = await self._product(self.a, "Un 50 kg")
        self.sugar = await self._product(self.a, "Shakar")

    async def asyncTearDown(self):
        await self.a.aclose()
        await self.b.aclose()
        await db_helper.dispose()

    async def _company(self, lang="uz"):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        client = httpx.AsyncClient(transport=transport, base_url="https://test")
        r = await client.post(
            f"{API}/auth/signup",
            json={
                "company_name": "Test",
                "name": "R",
                "login": random_phone(),
                "password": "secret-123",
                "lang": lang,
            },
        )
        self.assertEqual(r.status_code, 201)
        return client

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    async def _default_warehouse(self, client):
        rows = await self._ok(await client.get(f"{API}/warehouses"))
        return next(w for w in rows if w["is_default"])

    async def _product(self, client, name):
        return await self._ok(
            await client.post(f"{API}/products", json={"name": name, "unit": "bag"}),
            201,
        )

    async def _doc(self, kind, items, client=None, code=201, **extra):
        body = {
            "kind": kind,
            "warehouse_id": self.main["id"],
            "lines": [{"product_id": p["id"], "quantity": q} for p, q in items],
            **extra,
        }
        return await self._ok(
            await (client or self.a).post(f"{API}/stock-documents", json=body), code
        )

    async def _stock(self, client=None, **params):
        page = await self._ok(
            await (client or self.a).get(f"{API}/stock", params=params)
        )
        return {row["name"]: row for row in page["items"]}

    async def test_signup_creates_one_default_warehouse_in_the_owners_language(self):
        rows = await self._ok(await self.a.get(f"{API}/warehouses"))
        self.assertEqual(
            [(w["name"], w["is_default"]) for w in rows],
            [("Основной склад", True), ("Doʻkon", False)],
        )

    async def test_receipt_write_off_and_transfer_move_stock(self):
        await self._doc("receipt", [(self.flour, "100"), (self.sugar, "2.5")])
        await self._doc("write_off", [(self.flour, "3")])
        await self._doc(
            "transfer", [(self.flour, "20")], to_warehouse_id=self.shop["id"]
        )
        stock = await self._stock()
        main, shop = str(self.main["id"]), str(self.shop["id"])
        self.assertEqual(
            stock["Un 50 kg"]["quantities"], {main: "77.000", shop: "20.000"}
        )
        self.assertEqual(stock["Un 50 kg"]["total"], "97.000")
        self.assertEqual(stock["Shakar"]["total"], "2.500")
        only_shop = await self._stock(warehouse_id=self.shop["id"])
        self.assertEqual(only_shop["Un 50 kg"]["total"], "20.000")
        self.assertEqual(only_shop["Shakar"]["total"], "0.000")
        positive = await self._stock(warehouse_id=self.shop["id"], show="positive")
        self.assertEqual(list(positive), ["Un 50 kg"])

    async def test_numbers_count_per_kind_and_never_repeat_under_load(self):
        first = await self._doc("receipt", [(self.flour, "1")])
        off = await self._doc("write_off", [(self.flour, "1")])
        many = await asyncio.gather(
            *[self._doc("receipt", [(self.flour, "1")]) for _ in range(8)]
        )
        numbers = sorted(d["number"] for d in many)
        self.assertEqual((first["number"], off["number"]), (1, 1))
        self.assertEqual(numbers, list(range(2, 10)))

    async def test_going_below_zero_is_allowed_and_reported(self):
        await self._doc("receipt", [(self.flour, "5")])
        doc = await self._doc("write_off", [(self.flour, "8"), (self.sugar, "1")])
        self.assertEqual(
            sorted((n["product_name"], n["quantity"]) for n in doc["negative"]),
            [("Shakar", "-1.000"), ("Un 50 kg", "-3.000")],
        )
        negative = await self._stock(show="negative")
        self.assertEqual(sorted(negative), ["Shakar", "Un 50 kg"])

    async def test_cancelling_undoes_the_movement_and_keeps_the_document(self):
        receipt = await self._doc("receipt", [(self.flour, "10")])
        await self._doc("write_off", [(self.flour, "4")])
        r = await self._ok(
            await self.a.post(f"{API}/stock-documents/{receipt['id']}/cancel")
        )
        self.assertTrue(r["cancelled"])
        self.assertEqual(r["negative"][0]["quantity"], "-4.000")
        self.assertEqual((await self._stock())["Un 50 kg"]["total"], "-4.000")
        page = await self._ok(await self.a.get(f"{API}/stock-documents"))
        self.assertEqual(
            [(d["kind"], d["cancelled"], d["lines"]) for d in page["items"]],
            [("write_off", False, 1), ("receipt", True, 1)],
        )
        receipts = await self._ok(
            await self.a.get(f"{API}/stock-documents", params={"kind": "receipt"})
        )
        self.assertEqual(receipts["total"], 1)

    async def test_document_detail_has_names_units_and_prices(self):
        doc = await self._doc(
            "receipt",
            [],
            lines=[
                {"product_id": self.flour["id"], "quantity": "10", "price": "380000"},
                {"product_id": self.sugar["id"], "quantity": "1.25"},
            ],
            currency="UZS",
            note="Yuk mashinasi",
        )
        got = await self._ok(await self.a.get(f"{API}/stock-documents/{doc['id']}"))
        self.assertEqual(
            [
                (x["product_name"], x["unit"], x["quantity"], x["price"])
                for x in got["lines"]
            ],
            [
                ("Un 50 kg", "bag", "10.000", "380000.00"),
                ("Shakar", "bag", "1.250", None),
            ],
        )
        self.assertEqual((got["currency"], got["note"]), ("UZS", "Yuk mashinasi"))

    async def test_bad_documents_are_422(self):
        f = self.flour["id"]
        line = [{"product_id": f, "quantity": "1"}]
        bad = [
            {"kind": "transfer", "lines": line},
            {"kind": "transfer", "lines": line, "to_warehouse_id": self.main["id"]},
            {"kind": "receipt", "lines": line, "to_warehouse_id": self.shop["id"]},
            {
                "kind": "write_off",
                "lines": [{"product_id": f, "quantity": "1", "price": "5"}],
                "currency": "UZS",
            },
            {
                "kind": "receipt",
                "lines": [{"product_id": f, "quantity": "1", "price": "5"}],
            },
            {"kind": "receipt", "lines": []},
            {"kind": "receipt", "lines": [{"product_id": f, "quantity": "0"}]},
            {"kind": "receipt", "lines": [{"product_id": f, "quantity": "1.0005"}]},
            {"kind": "sale", "lines": line},
        ]
        for body in bad:
            r = await self.a.post(
                f"{API}/stock-documents", json={"warehouse_id": self.main["id"], **body}
            )
            self.assertEqual(r.status_code, 422, body)

    async def test_warehouse_with_stock_or_default_can_not_be_archived(self):
        url = f"{API}/warehouses/{self.shop['id']}"
        await self._doc("receipt", [(self.flour, "2")], warehouse_id=self.shop["id"])
        self.assertEqual(
            (await self.a.patch(url, json={"archived": True})).status_code, 422
        )
        await self._doc(
            "transfer",
            [(self.flour, "2")],
            warehouse_id=self.shop["id"],
            to_warehouse_id=self.main["id"],
        )
        await self._ok(await self.a.patch(url, json={"archived": True}))
        # an archived warehouse takes no new documents
        await self._doc(
            "receipt", [(self.flour, "1")], warehouse_id=self.shop["id"], code=422
        )
        r = await self.a.patch(
            f"{API}/warehouses/{self.main['id']}", json={"archived": True}
        )
        self.assertEqual(r.status_code, 422)

    async def test_default_warehouse_moves(self):
        await self._ok(
            await self.a.patch(
                f"{API}/warehouses/{self.shop['id']}", json={"is_default": True}
            )
        )
        rows = await self._ok(await self.a.get(f"{API}/warehouses"))
        self.assertEqual([w["id"] for w in rows if w["is_default"]], [self.shop["id"]])

    async def test_other_company_cannot_see_or_use(self):
        doc = await self._doc("receipt", [(self.flour, "9")])
        self.assertEqual(
            (await self._ok(await self.b.get(f"{API}/stock-documents")))["total"], 0
        )
        self.assertEqual(await self._stock(self.b), {})
        r = await self.b.get(f"{API}/stock-documents/{doc['id']}")
        self.assertEqual(r.status_code, 404)
        r = await self.b.post(f"{API}/stock-documents/{doc['id']}/cancel")
        self.assertEqual(r.status_code, 404)
        r = await self.b.get(
            f"{API}/stock/balances", params={"product_id": self.flour["id"]}
        )
        self.assertEqual(r.json(), {})
        mine = await self._product(self.b, "Mine")
        their_warehouse = {
            "warehouse_id": self.main["id"],
            "kind": "receipt",
            "lines": [{"product_id": mine["id"], "quantity": "1"}],
        }
        their_product = {
            "warehouse_id": (await self._default_warehouse(self.b))["id"],
            "kind": "receipt",
            "lines": [{"product_id": self.flour["id"], "quantity": "1"}],
        }
        for body in [their_warehouse, their_product]:
            r = await self.b.post(f"{API}/stock-documents", json=body)
            self.assertEqual(r.status_code, 422, body)

    async def test_balances_for_a_document_being_filled_in(self):
        await self._doc("receipt", [(self.flour, "7")])
        got = await self._ok(
            await self.a.get(
                f"{API}/stock/balances",
                params={"product_id": [self.flour["id"], self.sugar["id"]]},
            )
        )
        self.assertEqual(got, {str(self.flour["id"]): {str(self.main["id"]): "7.000"}})


if __name__ == "__main__":
    unittest.main()
