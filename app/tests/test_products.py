import unittest

import httpx
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.database import db_helper
from app.core.rls import set_tenant
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class ProductsApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company("ru")
        self.b = await self._company()

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
                "name": "Rustam",
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

    async def _default_list(self, client):
        lists = await self._ok(await client.get(f"{API}/price-lists"))
        return next(p for p in lists if p["is_default"])

    async def test_signup_creates_one_default_price_list_in_the_owners_language(self):
        lists = await self._ok(await self.a.get(f"{API}/price-lists"))
        self.assertEqual(
            [(p["name"], p["currency"], p["is_default"]) for p in lists],
            [("Основная цена", "UZS", True)],
        )
        self.assertEqual((await self._default_list(self.b))["name"], "Asosiy narx")

    async def test_create_with_prices_in_several_lists_and_currencies(self):
        main = await self._default_list(self.a)
        usd = await self._ok(
            await self.a.post(
                f"{API}/price-lists", json={"name": "Diler", "currency": "usd"}
            ),
            201,
        )
        self.assertEqual(usd["currency"], "USD")
        p = await self._ok(
            await self.a.post(
                f"{API}/products",
                json={
                    "name": "Un 1-nav 50 kg",
                    "sku": "UN-50",
                    "unit": "bag",
                    "mxik": "10611001001000000",
                    "prices": [
                        {"price_list_id": main["id"], "amount": "385000"},
                        {"price_list_id": usd["id"], "amount": 29.5},
                    ],
                },
            ),
            201,
        )
        prices = {x["price_list_id"]: x["amount"] for x in p["prices"]}
        self.assertEqual(prices, {main["id"]: "385000.00", usd["id"]: "29.50"})
        self.assertEqual((p["unit"], p["mxik"]), ("bag", "10611001001000000"))

    async def test_patch_sets_changes_and_removes_prices_and_keeps_the_rest(self):
        main = await self._default_list(self.a)
        other = await self._ok(
            await self.a.post(
                f"{API}/price-lists", json={"name": "Chakana", "currency": "UZS"}
            ),
            201,
        )
        p = await self._ok(
            await self.a.post(
                f"{API}/products",
                json={
                    "name": "Shakar",
                    "prices": [{"price_list_id": main["id"], "amount": "12000"}],
                },
            ),
            201,
        )
        url = f"{API}/products/{p['id']}"
        p = await self._ok(
            await self.a.patch(
                url,
                json={"prices": [{"price_list_id": other["id"], "amount": "13500.5"}]},
            )
        )
        self.assertEqual(len(p["prices"]), 2)
        p = await self._ok(
            await self.a.patch(
                url,
                json={
                    "name": "Shakar oq",
                    "prices": [
                        {"price_list_id": main["id"], "amount": "12500"},
                        {"price_list_id": other["id"], "amount": None},
                    ],
                },
            )
        )
        self.assertEqual(
            (p["name"], p["prices"]),
            ("Shakar oq", [{"price_list_id": main["id"], "amount": "12500.00"}]),
        )

    async def test_bad_input_is_422(self):
        main = await self._default_list(self.a)
        for body in [
            {"name": ""},
            {"name": "X", "unit": "litre"},
            {"name": "X", "mxik": "123"},
            {"name": "X", "prices": [{"price_list_id": main["id"], "amount": "-1"}]},
            {"name": "X", "prices": [{"price_list_id": main["id"], "amount": "1.005"}]},
            {"name": "X", "prices": [{"price_list_id": 999999999, "amount": "1"}]},
            {"name": "X", "category_id": 999999999},
        ]:
            r = await self.a.post(f"{API}/products", json=body)
            self.assertEqual(r.status_code, 422, body)
        r = await self.a.post(
            f"{API}/price-lists", json={"name": "Y", "currency": "dollar"}
        )
        self.assertEqual(r.status_code, 422)

    async def test_taken_article_or_barcode_is_409_with_the_existing_product(self):
        first = await self._ok(
            await self.a.post(
                f"{API}/products",
                json={"name": "Bir", "sku": "A-1", "barcode": "4780000000017"},
            ),
            201,
        )
        for field, value in [("sku", "A-1"), ("barcode", "4780000000017")]:
            r = await self.a.post(
                f"{API}/products", json={"name": "Ikki", field: value}
            )
            self.assertEqual(r.status_code, 409)
            self.assertEqual(r.json()["field"], field)
            self.assertEqual(r.json()["id"], first["id"])
        # another company may use the same codes
        await self._ok(
            await self.b.post(f"{API}/products", json={"name": "Bir", "sku": "A-1"}),
            201,
        )

    async def test_search_and_category_filter(self):
        cat = await self._ok(
            await self.a.post(f"{API}/product-categories", json={"name": "Un"}), 201
        )
        un = await self._ok(
            await self.a.post(
                f"{API}/products",
                json={"name": "Ун олий нав", "sku": "UN-1", "category_id": cat["id"]},
            ),
            201,
        )
        await self._ok(
            await self.a.post(f"{API}/products", json={"name": "Guruch"}), 201
        )
        for q in ["un oliy", "UN-1", "олий"]:
            page = await self._ok(await self.a.get(f"{API}/products", params={"q": q}))
            self.assertEqual([i["id"] for i in page["items"]], [un["id"]], q)
        page = await self._ok(
            await self.a.get(f"{API}/products", params={"category_id": cat["id"]})
        )
        self.assertEqual(page["total"], 1)
        cats = await self._ok(await self.a.get(f"{API}/product-categories"))
        self.assertEqual([(c["name"], c["products"]) for c in cats], [("Un", 1)])

    async def test_deleting_a_category_keeps_its_products(self):
        cat = await self._ok(
            await self.a.post(f"{API}/product-categories", json={"name": "Yog"}), 201
        )
        p = await self._ok(
            await self.a.post(
                f"{API}/products",
                json={"name": "Paxta yogʻi", "category_id": cat["id"]},
            ),
            201,
        )
        r = await self.a.delete(f"{API}/product-categories/{cat['id']}")
        self.assertEqual(r.status_code, 204)
        got = await self._ok(await self.a.get(f"{API}/products/{p['id']}"))
        self.assertIsNone(got["category_id"])

    async def test_archive_product(self):
        p = await self._ok(
            await self.a.post(f"{API}/products", json={"name": "Eski"}), 201
        )
        await self._ok(
            await self.a.patch(f"{API}/products/{p['id']}", json={"archived": True})
        )
        self.assertEqual(
            (await self._ok(await self.a.get(f"{API}/products")))["total"], 0
        )
        archived = await self._ok(
            await self.a.get(f"{API}/products", params={"archived": True})
        )
        self.assertEqual(archived["total"], 1)

    async def test_default_moves_and_can_not_be_archived(self):
        main = await self._default_list(self.a)
        new = await self._ok(
            await self.a.post(
                f"{API}/price-lists", json={"name": "Yangi", "currency": "UZS"}
            ),
            201,
        )
        r = await self.a.patch(
            f"{API}/price-lists/{main['id']}", json={"archived": True}
        )
        self.assertEqual(r.status_code, 422)
        await self._ok(
            await self.a.patch(
                f"{API}/price-lists/{new['id']}", json={"is_default": True}
            )
        )
        lists = await self._ok(await self.a.get(f"{API}/price-lists"))
        self.assertEqual([p["id"] for p in lists if p["is_default"]], [new["id"]])
        # the old default can be archived now, and then takes no prices
        await self._ok(
            await self.a.patch(
                f"{API}/price-lists/{main['id']}", json={"archived": True}
            )
        )
        r = await self.a.post(
            f"{API}/products",
            json={
                "name": "X",
                "prices": [{"price_list_id": main["id"], "amount": "1"}],
            },
        )
        self.assertEqual(r.status_code, 422)

    async def test_customer_price_list(self):
        lst = await self._ok(
            await self.a.post(
                f"{API}/price-lists", json={"name": "Diler", "currency": "USD"}
            ),
            201,
        )
        c = await self._ok(
            await self.a.post(
                f"{API}/customers", json={"name": "Firma", "price_list_id": lst["id"]}
            ),
            201,
        )
        self.assertEqual(c["price_list_id"], lst["id"])
        other = await self._default_list(self.b)
        r = await self.a.patch(
            f"{API}/customers/{c['id']}", json={"price_list_id": other["id"]}
        )
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "price_list_id"])

    async def test_other_company_cannot_see_or_use(self):
        main = await self._default_list(self.a)
        cat = await self._ok(
            await self.a.post(f"{API}/product-categories", json={"name": "Maxfiy"}), 201
        )
        p = await self._ok(
            await self.a.post(f"{API}/products", json={"name": "M"}), 201
        )
        self.assertEqual(
            (await self._ok(await self.b.get(f"{API}/products")))["total"], 0
        )
        self.assertEqual(
            await self._ok(await self.b.get(f"{API}/product-categories")), []
        )
        self.assertNotIn(
            main["id"],
            [x["id"] for x in await self._ok(await self.b.get(f"{API}/price-lists"))],
        )
        for r in [
            await self.b.get(f"{API}/products/{p['id']}"),
            await self.b.patch(f"{API}/products/{p['id']}", json={"name": "x"}),
            await self.b.patch(f"{API}/price-lists/{main['id']}", json={"name": "x"}),
            await self.b.delete(f"{API}/product-categories/{cat['id']}"),
        ]:
            self.assertEqual(r.status_code, 404)
        for body in [
            {"name": "x", "category_id": cat["id"]},
            {"name": "x", "prices": [{"price_list_id": main["id"], "amount": "1"}]},
        ]:
            self.assertEqual(
                (await self.b.post(f"{API}/products", json=body)).status_code, 422
            )


@needs_db
class PriceTenantTest(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        await db_helper.dispose()

    async def test_price_cannot_join_another_companys_product_or_list(self):
        # foreign keys skip row-level security, so the (id, tenant_id) keys are the guard
        async with db_helper.session_factory() as s:
            a = (await s.execute(text("SELECT auth_create_tenant('A')"))).scalar_one()
            b = (await s.execute(text("SELECT auth_create_tenant('B')"))).scalar_one()
            await set_tenant(s, a)
            product = (
                await s.execute(
                    text(
                        "INSERT INTO product (tenant_id, name, unit, name_key, search) "
                        "VALUES (:t, 'x', 'pcs', 'x', 'x') RETURNING id"
                    ),
                    {"t": a},
                )
            ).scalar_one()
            await s.commit()
        async with db_helper.session_factory() as s:
            await set_tenant(s, b)
            plist = (
                await s.execute(
                    text(
                        "INSERT INTO price_list (tenant_id, name, currency) "
                        "VALUES (:t, 'b', 'UZS') RETURNING id"
                    ),
                    {"t": b},
                )
            ).scalar_one()
            with self.assertRaises(IntegrityError):
                await s.execute(
                    text(
                        "INSERT INTO product_price (tenant_id, product_id, price_list_id, amount) "
                        "VALUES (:t, :p, :l, 1)"
                    ),
                    {"t": b, "p": product, "l": plist},
                )

    async def test_only_one_default_list_per_company(self):
        async with db_helper.session_factory() as s:
            a = (await s.execute(text("SELECT auth_create_tenant('A')"))).scalar_one()
            await set_tenant(s, a)
            insert = text(
                "INSERT INTO price_list (tenant_id, name, currency, is_default) "
                "VALUES (:t, :n, 'UZS', true)"
            )
            await s.execute(insert, {"t": a, "n": "one"})
            with self.assertRaises(IntegrityError):
                await s.execute(insert, {"t": a, "n": "two"})


if __name__ == "__main__":
    unittest.main()
