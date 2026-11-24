import unittest

import httpx
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.database import db_helper
from app.core.rls import set_tenant
from app.core.text import name_key, search_key
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1/customers"


class SearchKeyTest(unittest.TestCase):
    def test_latin_and_cyrillic_spellings_meet(self):
        for spelling in [
            "Oʻzbekiston",
            "O'zbekiston",
            "O`zbekiston",
            "Ўзбекистон",
            "ozbekiston",
        ]:
            self.assertEqual(search_key(spelling), "ozbekiston", spelling)
        self.assertEqual(search_key("Gʻalla"), search_key("Ғалла"))
        self.assertEqual(search_key("Шаҳар-Чорсу"), "shahar chorsu")

    def test_name_key_drops_legal_forms_and_quotes(self):
        self.assertEqual(name_key("MChJ «Gʻalla Savdo»"), "galla savdo")
        self.assertEqual(name_key('ООО "Галла Савдо"'), "galla savdo")


@needs_db
class CustomersApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()

    async def asyncTearDown(self):
        await self.a.aclose()
        await self.b.aclose()
        await db_helper.dispose()

    async def _company(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        client = httpx.AsyncClient(transport=transport, base_url="https://test")
        r = await client.post(
            "/api/v1/auth/signup",
            json={
                "company_name": "Test",
                "name": "Rustam",
                "login": random_phone(),
                "password": "secret-123",
            },
        )
        self.assertEqual(r.status_code, 201)
        return client

    async def _add(self, client, **fields):
        r = await client.post(API, json=fields)
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    async def test_create_normalizes_and_reads_back(self):
        c = await self._add(
            self.a,
            name="  Gʻalla Savdo ",
            inn="301 234 567",
            phone="90 123 45 67",
            address="",
        )
        self.assertEqual(
            (c["name"], c["inn"], c["phone"], c["address"]),
            ("Gʻalla Savdo", "301234567", "+998901234567", None),
        )
        got = (await self.a.get(f"{API}/{c['id']}")).json()
        self.assertEqual((got["contacts"], got["archived"]), ([], False))

    async def test_bad_input_is_422(self):
        for body in [
            {"name": ""},
            {"name": "X", "inn": "12345"},
            {"name": "X", "phone": "12"},
        ]:
            self.assertEqual((await self.a.post(API, json=body)).status_code, 422, body)
        c = await self._add(self.a, name="X")
        r = await self.a.patch(f"{API}/{c['id']}", json={"name": None})
        self.assertEqual(r.status_code, 422)

    async def test_search_any_script_and_by_inn_or_phone(self):
        c = await self._add(
            self.a, name="Oʻzbek Ombor", inn="301234567", phone="+998 93 111 22 33"
        )
        await self._add(self.a, name="Boshqa firma")
        for q in ["ўзбек", "o'zbek omb", "ozbek", "3012345", "931112233"]:
            page = (await self.a.get(API, params={"q": q})).json()
            self.assertEqual([i["id"] for i in page["items"]], [c["id"]], q)
            self.assertEqual(page["total"], 1)
        # punctuation alone is no filter, and never a LIKE wildcard
        self.assertEqual((await self.a.get(API, params={"q": "%"})).json()["total"], 2)

    async def test_paging(self):
        for n in range(3):
            await self._add(self.a, name=f"Firma {n}")
        page = (await self.a.get(API, params={"limit": 2, "offset": 2})).json()
        self.assertEqual(
            (page["total"], [i["name"] for i in page["items"]]), (3, ["Firma 2"])
        )

    async def test_same_inn_twice_is_409_with_the_existing_customer(self):
        first = await self._add(self.a, name="Bir", inn="301234567")
        r = await self.a.post(API, json={"name": "Ikki", "inn": "301234567"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(
            r.json(), {"detail": "Already exists", "field": "inn", "id": first["id"]}
        )
        other = await self._add(self.a, name="Ikki", inn="301234568")
        r = await self.a.patch(f"{API}/{other['id']}", json={"inn": "301234567"})
        self.assertEqual(r.status_code, 409)
        # another company may have a customer with the same ИНН
        await self._add(self.b, name="Bir", inn="301234567")

    async def test_similar_names_are_found_across_scripts_and_legal_forms(self):
        c = await self._add(self.a, name="MChJ «Gʻalla Savdo»")
        await self._add(self.a, name="Temir Beton")
        r = await self.a.get(f"{API}/similar", params={"name": 'ООО "Галла-Савдо"'})
        self.assertEqual([i["id"] for i in r.json()], [c["id"]])
        r = await self.a.get(
            f"{API}/similar", params={"name": "Galla Savdo", "exclude": c["id"]}
        )
        self.assertEqual(r.json(), [])

    async def test_archive_and_restore(self):
        c = await self._add(self.a, name="Eski")
        r = await self.a.patch(f"{API}/{c['id']}", json={"archived": True})
        self.assertTrue(r.json()["archived"])
        self.assertEqual((await self.a.get(API)).json()["total"], 0)
        archived = (await self.a.get(API, params={"archived": True})).json()
        self.assertEqual([i["id"] for i in archived["items"]], [c["id"]])
        r = await self.a.patch(
            f"{API}/{c['id']}", json={"archived": False, "note": "qaytdi"}
        )
        self.assertEqual((r.json()["archived"], r.json()["note"]), (False, "qaytdi"))

    async def test_edit_changes_only_sent_fields_and_updates_search(self):
        c = await self._add(self.a, name="Eski nom", phone="901234567", note="izoh")
        r = await self.a.patch(
            f"{API}/{c['id']}", json={"name": "Yangi nom", "phone": ""}
        )
        body = r.json()
        self.assertEqual(
            (body["name"], body["phone"], body["note"]), ("Yangi nom", None, "izoh")
        )
        self.assertEqual(
            (await self.a.get(API, params={"q": "янги"})).json()["total"], 1
        )

    async def test_contacts(self):
        c = await self._add(self.a, name="Firma")
        url = f"{API}/{c['id']}/contacts"
        r = await self.a.post(
            url, json={"name": "Aziz", "phone": "901112233", "position": "Buxgalter"}
        )
        self.assertEqual(r.status_code, 201)
        contact = r.json()
        self.assertEqual(contact["phone"], "+998901112233")
        r = await self.a.patch(f"{url}/{contact['id']}", json={"position": "Direktor"})
        self.assertEqual(r.json()["position"], "Direktor")
        second = (await self.a.post(url, json={"name": "Dilnoza"})).json()
        names = [
            x["name"] for x in (await self.a.get(f"{API}/{c['id']}")).json()["contacts"]
        ]
        self.assertEqual(names, ["Aziz", "Dilnoza"])
        self.assertEqual(
            (await self.a.delete(f"{url}/{contact['id']}")).status_code, 204
        )
        contacts = (await self.a.get(f"{API}/{c['id']}")).json()["contacts"]
        self.assertEqual([x["id"] for x in contacts], [second["id"]])
        self.assertEqual(
            (await self.a.delete(f"{url}/{contact['id']}")).status_code, 404
        )

    async def test_other_company_cannot_see_or_touch(self):
        c = await self._add(self.a, name="Maxfiy", inn="309999999")
        contact = (
            await self.a.post(f"{API}/{c['id']}/contacts", json={"name": "Aziz"})
        ).json()
        url = f"{API}/{c['id']}"
        self.assertEqual((await self.b.get(API)).json()["total"], 0)
        self.assertEqual(
            (await self.b.get(f"{API}/similar", params={"name": "Maxfiy"})).json(), []
        )
        self.assertEqual((await self.b.get(url)).status_code, 404)
        self.assertEqual((await self.b.patch(url, json={"name": "x"})).status_code, 404)
        self.assertEqual(
            (await self.b.post(f"{url}/contacts", json={"name": "x"})).status_code, 404
        )
        r = await self.b.delete(f"{url}/contacts/{contact['id']}")
        self.assertEqual(r.status_code, 404)
        self.assertEqual((await self.a.get(url)).json()["name"], "Maxfiy")


@needs_db
class ContactTenantTest(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        await db_helper.dispose()

    async def test_contact_cannot_point_at_another_companys_customer(self):
        # foreign keys skip row-level security, so the (customer_id, tenant_id) key is the guard
        async with db_helper.session_factory() as s:
            a = (await s.execute(text("SELECT auth_create_tenant('A')"))).scalar_one()
            b = (await s.execute(text("SELECT auth_create_tenant('B')"))).scalar_one()
            await set_tenant(s, a)
            customer = (
                await s.execute(
                    text(
                        "INSERT INTO customer (tenant_id, name, name_key, search) "
                        "VALUES (:t, 'x', 'x', 'x') RETURNING id"
                    ),
                    {"t": a},
                )
            ).scalar_one()
            await s.commit()
        async with db_helper.session_factory() as s:
            await set_tenant(s, b)
            with self.assertRaises(IntegrityError):
                await s.execute(
                    text(
                        "INSERT INTO customer_contact (tenant_id, customer_id, name) "
                        "VALUES (:t, :c, 'spy')"
                    ),
                    {"t": b, "c": customer},
                )


if __name__ == "__main__":
    unittest.main()
