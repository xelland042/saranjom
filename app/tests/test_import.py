import unittest
import zipfile
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

import httpx
from openpyxl import Workbook

from app.core.database import db_helper
from app.core.errors import InvalidField
from app.crud.imports import (
    MAX_UNPACKED,
    RowFailed,
    _number,
    _text,
    guess,
    read_sheet,
)
from app.schemas.imports import MAX_ROWS
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


def xlsx(*rows) -> bytes:
    wb = Workbook()
    for row in rows:
        wb.active.append(list(row))
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


class GuessTest(unittest.TestCase):
    def test_1c_and_our_own_headers(self):
        self.assertEqual(
            guess(
                ["Код", "Наименование", "Ед. изм.", "Штрих-код", "Код ИКПУ"], "products"
            ),
            {"name": 1, "mxik": 4, "barcode": 3, "sku": 0, "unit": 2},
        )
        # a header that only contains the word, in Uzbek Cyrillic and Latin
        self.assertEqual(
            guess(["Номи", "STIR", "Qarz", "Сальдо на конец периода"], "customers"),
            {"name": 0, "inn": 1, "debt": 2},
        )
        self.assertEqual(
            guess(["Товар", "Цена продажи, сум", "Остаток"], "products"),
            {"name": 0, "price": 1, "quantity": 2},
        )
        # what it was bought at isn't what it sells at
        self.assertEqual(
            guess(["Товар", "Закупочная цена, сум", "Цена", "Tannarx"], "products"),
            {"name": 0, "cost": 3, "price": 2},
        )
        self.assertEqual(
            guess(["Товар", "Закупочная цена, сум", "Цена продажи"], "products"),
            {"name": 0, "cost": 1, "price": 2},
        )


class ParsingTest(unittest.TestCase):
    """How cells from real files become values, without a database."""

    def test_numbers_as_people_type_them(self):
        for text, value in [
            ("12 500,50", "12500.50"),  # Russian Excel
            ("12,500.50", "12500.50"),  # English Excel
            ("12.500,50", "12500.50"),  # German style
            ("1,5", "1.5"),
            ("1,234,567", "1234567"),
            ("1\u00a0000", "1000"),  # a no-break space from a copied table
            ("1'000", "1000"),
            ("-250000", "-250000"),  # paid ahead
        ]:
            self.assertEqual(_number(text, "price"), Decimal(value), text)
        for bad in ["abc", "NaN", "Infinity", "1..2", "12 so'm"]:
            with self.assertRaises(RowFailed, msg=bad):
                _number(bad, "price")

    def test_cells_read_as_a_person_reads_them(self):
        self.assertEqual(
            _text(301234567.0), "301234567"
        )  # an ИНН Excel stored as a number
        self.assertEqual(_text(1250000.5), "1250000.5")
        self.assertEqual(_text(datetime(2026, 11, 23)), "2026-11-23")
        self.assertEqual(_text(datetime(2026, 11, 23, 9, 30)), "2026-11-23T09:30:00")
        self.assertEqual(_text(date(2026, 11, 23)), "2026-11-23")
        self.assertEqual(_text("  Baraka  "), "Baraka")
        for empty in (None, "", "   "):
            self.assertIsNone(_text(empty))

    def test_files_it_refuses(self):
        def refused(data: bytes) -> str:
            with self.assertRaises(InvalidField) as e:
                read_sheet(data, "customers")
            return e.exception.message

        self.assertIn(".xlsx", refused(b"a;b;c\n1;2;3"))  # a CSV
        self.assertIn("empty", refused(xlsx()))
        self.assertIn(
            str(MAX_ROWS),
            refused(xlsx(["Nomi"], *[[f"m{i}"] for i in range(MAX_ROWS + 25)])),
        )
        # a small zip that unpacks huge (a zip bomb) is refused before it's opened
        bomb = BytesIO()
        with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("xl/worksheets/sheet1.xml", b"\0" * (MAX_UNPACKED + 1))
        self.assertLess(len(bomb.getvalue()), 1_000_000)
        self.assertIn("too big", refused(bomb.getvalue()))

    def test_a_blank_header_cell_is_named_by_its_column(self):
        sheet = read_sheet(xlsx(["Nomi", None, "Narx"], ["Un", "x", 100]), "products")
        self.assertEqual(sheet.columns, ["Nomi", "B", "Narx"])
        self.assertEqual(sheet.guess, {"name": 0, "price": 2})


@needs_db
class ImportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.c = await self._client()
        await self._ok(
            await self.c.post(
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
        self.baraka = await self._post(
            "/customers", {"name": "Baraka MChJ", "inn": "301234567"}
        )
        self.oila = await self._post("/customers", {"name": "Oila Market"})
        self.wh = (await self._ok(await self.c.get(f"{API}/warehouses")))[0]["id"]
        self.oil = await self._post("/products", {"name": "Moy", "sku": "A1"})
        await self._post(
            "/stock-documents",
            {
                "kind": "receipt",
                "warehouse_id": self.wh,
                "lines": [{"product_id": self.oil["id"], "quantity": "10"}],
            },
        )

    async def asyncTearDown(self):
        await db_helper.dispose()

    async def _client(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        return httpx.AsyncClient(transport=transport, base_url="https://test")

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json() if r.content else None

    async def _post(self, path, body, code=201):
        return await self._ok(await self.c.post(f"{API}{path}", json=body), code)

    async def test_read_finds_the_header_under_a_title(self):
        data = xlsx(
            ["Контрагенты"],
            [],
            ["Наименование", "ИНН", "Телефон", "Долг"],
            ["Baraka MChJ", 301234567, "+998 90 123 45 67", 1250000.5],
        )
        r = await self.c.post(f"{API}/import/customers/read", content=data)
        sheet = await self._ok(r)
        self.assertEqual(sheet["columns"], ["Наименование", "ИНН", "Телефон", "Долг"])
        self.assertEqual(
            sheet["rows"],
            [
                {
                    "row": 4,
                    "cells": [
                        "Baraka MChJ",
                        "301234567",
                        "+998 90 123 45 67",
                        "1250000.5",
                    ],
                }
            ],
        )
        self.assertEqual(sheet["guess"], {"name": 0, "inn": 1, "phone": 2, "debt": 3})
        r = await self.c.post(f"{API}/import/customers/read", content=b"a;b;c\n1;2;3")
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "file"])
        # the template's own headers come back recognised
        r = await self.c.get(f"{API}/import/products/template", params={"lang": "ru"})
        sheet = await self._ok(
            await self.c.post(f"{API}/import/products/read", content=r.content)
        )
        self.assertEqual(len(sheet["guess"]), len(sheet["columns"]))

    async def test_customers_preview_then_save_then_nothing_to_do(self):
        rows = [
            # matched by ИНН: the address is new, the empty phone changes nothing
            {
                "row": 2,
                "name": "Baraka MChJ",
                "inn": "301 234 567",
                "address": "Chorsu",
            },
            # matched by name, gets an ИНН
            {"row": 3, "name": "OILA market", "inn": "302000000"},
            {"row": 4, "name": "Yangi Hayot", "debt": "1 250 000,50"},
            {"row": 5, "name": "Bad", "inn": "12"},
            {"row": 6, "name": "Again", "inn": "302000000"},
            {"row": 7, "inn": "303000000"},
            {"row": 8, "name": "Late", "debt": "-500"},
            {"row": 9},  # empty
        ]
        body = {"rows": rows, "date": "2026-01-01"}
        preview = await self._post("/import/customers", body, 200)
        expected = {
            "created": 2,
            "new_rows": [4, 8],
            "updated": 2,
            "unchanged": 0,
            "debts": 2,
            "stock": [],
            "errors": [
                {"row": 5, "field": "inn", "code": "invalid", "other": None},
                {"row": 6, "field": "inn", "code": "repeats", "other": 3},
                {"row": 7, "field": "name", "code": "missing", "other": None},
            ],
        }
        self.assertEqual(preview, expected)
        page = await self._ok(await self.c.get(f"{API}/customers"))
        self.assertEqual(page["total"], 2)  # the preview saved nothing

        self.assertEqual(
            await self._post("/import/customers", {**body, "dry_run": False}, 200),
            expected,
        )
        baraka = await self._ok(
            await self.c.get(f"{API}/customers/{self.baraka['id']}")
        )
        self.assertEqual(baraka["address"], "Chorsu")
        oila = await self._ok(await self.c.get(f"{API}/customers/{self.oila['id']}"))
        self.assertEqual((oila["name"], oila["inn"]), ("OILA market", "302000000"))
        page = await self._ok(
            await self.c.get(f"{API}/customers", params={"q": "yangi"})
        )
        yangi = page["items"][0]
        self.assertEqual(yangi["balances"][0]["balance"], "1250000.50")

        again = await self._post("/import/customers", {**body, "dry_run": False}, 200)
        self.assertEqual(
            (again["created"], again["updated"], again["unchanged"], again["debts"]),
            (0, 0, 4, 0),
        )

    async def test_products_stock_is_set_not_added(self):
        rows = [
            {"row": 2, "sku": "A1", "name": "Moy", "quantity": "4"},
            {
                "row": 3,
                "name": "Un",
                "unit": "мешок",
                "price": "12 000",
                "quantity": "5",
                "category": "Bakaleya",
            },
            {"row": 4, "name": "Shakar", "unit": "xyz"},
            {"row": 5, "name": "Tuz", "sku": "A1"},
        ]
        body = {"rows": rows, "warehouse_id": self.wh, "dry_run": False}
        r = await self.c.post(
            f"{API}/import/products", json={**body, "warehouse_id": None}
        )
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "warehouse_id"])

        done = await self._post("/import/products", body, 200)
        self.assertEqual((done["created"], done["unchanged"]), (1, 1))
        self.assertEqual(
            [(e["row"], e["field"], e["code"]) for e in done["errors"]],
            [(4, "unit", "unit"), (5, "sku", "repeats")],
        )
        self.assertEqual(
            sorted(d["kind"] for d in done["stock"]), ["receipt", "write_off"]
        )
        stock = await self._ok(await self.c.get(f"{API}/stock"))
        totals = {s["name"]: s["total"] for s in stock["items"]}
        self.assertEqual(totals, {"Moy": "4.000", "Un": "5.000"})
        products = await self._ok(
            await self.c.get(f"{API}/products", params={"q": "un"})
        )
        un = products["items"][0]
        self.assertEqual((un["unit"], un["prices"][0]["amount"]), ("bag", "12000.00"))
        self.assertIsNotNone(un["category_id"])

        again = await self._post("/import/products", body, 200)
        self.assertEqual((again["created"], again["unchanged"]), (0, 2))
        self.assertEqual(again["stock"], [])

    async def test_products_cost_column(self):
        rows = [
            {"row": 2, "name": "Un", "cost": "8 500,5"},
            {"row": 3, "name": "Tuz", "cost": "-1"},
        ]
        body = {"rows": rows, "dry_run": False}
        done = await self._post("/import/products", body, 200)
        self.assertEqual(done["created"], 1)
        self.assertEqual(
            [(e["row"], e["field"], e["code"]) for e in done["errors"]],
            [(3, "cost", "invalid")],
        )
        find = {"params": {"q": "un"}}
        products = await self._ok(await self.c.get(f"{API}/products", **find))
        self.assertEqual(
            [(p["name"], p["cost"]) for p in products["items"]], [("Un", "8500.50")]
        )
        again = await self._post("/import/products", body, 200)
        self.assertEqual((again["created"], again["unchanged"]), (0, 1))
        # an empty cell never clears a cost
        rows[0]["cost"] = " "
        await self._post("/import/products", body, 200)
        products = await self._ok(await self.c.get(f"{API}/products", **find))
        self.assertEqual(products["items"][0]["cost"], "8500.50")

    async def test_debts_and_stock_need_their_own_permission(self):
        role = await self._post(
            "/roles",
            {"name": "Clerk", "permissions": ["customers.write", "products.write"]},
        )
        login = random_phone()
        await self._post(
            "/staff",
            {
                "name": "Clerk",
                "login": login,
                "password": "secret-456",
                "role_id": role["id"],
            },
        )
        clerk = await self._client()
        await self._ok(
            await clerk.post(
                f"{API}/auth/login", json={"login": login, "password": "secret-456"}
            )
        )
        r = await clerk.post(
            f"{API}/import/customers", json={"rows": [{"row": 2, "name": "A"}]}
        )
        self.assertEqual(r.status_code, 200)
        r = await clerk.post(
            f"{API}/import/customers",
            json={"rows": [{"row": 2, "name": "A", "debt": "5"}]},
        )
        self.assertEqual(r.status_code, 403)
        r = await clerk.post(
            f"{API}/import/products",
            json={
                "rows": [{"row": 2, "name": "A", "quantity": "5"}],
                "warehouse_id": self.wh,
            },
        )
        self.assertEqual(r.status_code, 403)
        await clerk.aclose()


if __name__ == "__main__":
    unittest.main()
