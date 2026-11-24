import datetime as dt
import unittest
from decimal import Decimal
import xml.etree.ElementTree as ET

import httpx

from app.core.database import db_helper
from app.crud.debts import today
from app.crud.onec import vat_name
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


def tag(el) -> str:
    return el.tag.split("}")[1]


def find(el, path: str):
    """A child by a path of plain names, whatever the namespace."""
    for name in path.split("/"):
        el = next(c for c in el if tag(c) == name)
    return el


@needs_db
class OneCExportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        self.c = httpx.AsyncClient(transport=transport, base_url="https://test")
        await self._ok(
            await self.c.post(
                f"{API}/auth/signup",
                json={
                    "company_name": "Gʻalla Savdo",
                    "name": "Owner",
                    "login": random_phone(),
                    "password": "secret-123",
                },
            ),
            201,
        )
        # the app's day (Tashkent), not the machine's: CI runs on UTC
        self.today = today()
        customer = await self._ok(
            await self.c.post(
                f"{API}/customers", json={"name": "Baraka MChJ", "inn": "301234567"}
            ),
            201,
        )
        self.customer_id = customer["id"]
        oil = await self._post("/products", {"name": "Moy", "unit": "l"})
        flour = await self._post("/products", {"name": "Un", "unit": "bag"})
        await self._post("/vat-rates", {"rate": "12", "valid_from": "2020-01-01"})
        lines = [
            {"product_id": oil["id"], "quantity": "50", "price": "60"},
            {
                "product_id": flour["id"],
                "quantity": "3",
                "price": "2000",
                "discount": "10",
            },
        ]
        sale = await self._post(
            "/orders", {"customer_id": self.customer_id, "lines": lines}
        )
        await self._ok(await self.c.post(f"{API}/orders/{sale['id']}/confirm"))
        self.sale = sale
        # a cancelled order and a cancelled payment don't go to 1C
        gone = await self._post(
            "/orders", {"customer_id": self.customer_id, "lines": lines[:1]}
        )
        await self._ok(await self.c.post(f"{API}/orders/{gone['id']}/confirm"))
        await self._ok(await self.c.post(f"{API}/orders/{gone['id']}/cancel"))
        await self._post(
            "/payments", {"customer_id": self.customer_id, "amount": "7000"}
        )
        await self._post(
            "/payments",
            {"customer_id": self.customer_id, "amount": "500", "method": "transfer"},
        )
        dropped = await self._post(
            "/payments", {"customer_id": self.customer_id, "amount": "1"}
        )
        await self._ok(await self.c.post(f"{API}/payments/{dropped['id']}/cancel"))

    async def asyncTearDown(self):
        await self.c.aclose()
        await db_helper.dispose()

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json() if r.content else None

    async def _post(self, path, body):
        return await self._ok(await self.c.post(f"{API}{path}", json=body), 201)

    async def _export(self, version="1.5", day=None):
        day = day or self.today
        return await self.c.get(
            f"{API}/onec/export",
            params={"date_from": day, "date_to": day, "version": version},
        )

    async def _body(self, version="1.5", day=None):
        r = await self._export(version, day)
        self.assertEqual(r.status_code, 200, r.text)
        root = ET.fromstring(r.content)
        self.assertEqual(
            find(root, "Header/Format").text,
            f"http://v8.1c.ru/edi/edi_stnd/EnterpriseData/{version}",
        )
        return root[-1]

    async def test_needs_the_company_inn_first(self):
        r = await self._export()
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "inn"])
        bad = await self.c.patch(f"{API}/company", json={"inn": "12"})
        self.assertEqual(bad.status_code, 422)
        await self._ok(
            await self.c.patch(f"{API}/company", json={"inn": "305 555 555"})
        )
        me = await self._ok(await self.c.get(f"{API}/auth/me"))
        self.assertEqual(me["company_inn"], "305555555")
        # a bank payment in the period needs the company's account too
        r = await self._export()
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "bank_account"])
        bad = await self.c.patch(f"{API}/company", json={"bank_account": "123"})
        self.assertEqual(bad.status_code, 422)

    async def test_sales_and_payments_as_1c_writes_them(self):
        await self._ok(
            await self.c.patch(
                f"{API}/company",
                json={"inn": "305555555", "bank_account": "20208000900123456001"},
            )
        )
        body = await self._body()
        kinds = [tag(d) for d in body]
        self.assertEqual(
            kinds,
            [
                "Документ.РеализацияТоваровУслуг",
                "Документ.ПКОРасчетыСКонтрагентами",
                "Документ.ПБДСРасчетыСКонтрагентами",
            ],
        )
        sale, cash, bank = body
        self.assertEqual(
            find(sale, "КлючевыеСвойства/Номер").text, str(self.sale["number"])
        )
        self.assertEqual(
            find(sale, "КлючевыеСвойства/Организация/ИНН").text, "305555555"
        )
        # the company goes by its own name until a 1C spelling is saved
        org = "КлючевыеСвойства/Организация/Наименование"
        self.assertEqual(find(sale, org).text, "Gʻalla Savdo")
        await self._ok(
            await self.c.patch(f"{API}/company", json={"onec_name": "ООО Галла Савдо"})
        )
        self.assertEqual(find((await self._body())[0], org).text, "ООО Галла Савдо")
        self.assertEqual(find(sale, "Контрагент/ИНН").text, "301234567")
        self.assertEqual(find(sale, "Валюта/Код").text, "860")
        self.assertEqual(find(sale, "Налогообложение").text, "ПродажаОблагаетсяНДС")
        oil, flour = find(sale, "Товары")
        self.assertEqual(find(oil, "ЕдиницаИзмерения/Код").text, "112")
        self.assertEqual(find(oil, "Количество").text, "50")
        # 1C's format has no 12%: no rate and no amount, the accountant picks 12% in 1C
        self.assertEqual(
            [tag(c) for c in oil if tag(c) in ("СтавкаНДС", "СуммаНДС")], []
        )
        self.assertEqual(vat_name(Decimal("20")), "НДС20")
        self.assertEqual(vat_name(Decimal("0")), "БезНДС")
        # the price after the 10% discount, so quantity × price is the sum
        self.assertEqual(find(flour, "Сумма").text, "5400.00")
        self.assertEqual(find(flour, "Цена").text, "1800.00")
        self.assertEqual(find(sale, "Сумма").text, "8400.00")
        self.assertEqual(find(cash, "ОбщиеДанные/Сумма").text, "7000.00")
        self.assertEqual(find(bank, "ОбщиеДанные/Сумма").text, "500.00")
        account = find(bank, "ОбщиеДанные/БанковскийСчетОрганизации")
        self.assertEqual(find(account, "НомерСчета").text, "20208000900123456001")
        self.assertEqual(
            find(account, "Владелец/ОрганизацииСсылка/ИНН").text, "305555555"
        )
        # one customer and one contract, the same ID wherever they appear
        refs = {find(d, "Контрагент/Ссылка").text for d in body} | {
            find(sale, "ДанныеВзаиморасчетов/Договор/Контрагент/Ссылка").text
        }
        self.assertEqual(len(refs), 1)
        contracts = {
            find(sale, "ДанныеВзаиморасчетов/Договор/Ссылка").text,
            find(
                cash, "РасшифровкаПлатежа/Строка/ДанныеВзаиморасчетов/Договор/Ссылка"
            ).text,
        }
        self.assertEqual(len(contracts), 1)
        # exporting again gives the same IDs, so 1C updates instead of duplicating
        again = await self._body()
        self.assertEqual(
            [find(d, "КлючевыеСвойства/Ссылка").text for d in again],
            [find(d, "КлючевыеСвойства/Ссылка").text for d in body],
        )

    async def test_a_14_digit_pinfl_is_left_out_of_the_file(self):
        # the format's ИНН holds 12 characters: a ПИНФЛ in it makes 1C refuse the whole file
        await self._ok(
            await self.c.patch(
                f"{API}/company",
                json={"inn": "31234567890123", "bank_account": "20208000900123456001"},
            )
        )
        await self._ok(
            await self.c.patch(
                f"{API}/customers/{self.customer_id}", json={"inn": "41234567890123"}
            )
        )
        sale = (await self._body("1.4"))[0]
        for who in ("Контрагент", "КлючевыеСвойства/Организация"):
            el = find(sale, who)
            self.assertNotIn("ИНН", [tag(c) for c in el])
            self.assertEqual(
                find(el, "ЮридическоеФизическоеЛицо").text, "ФизическоеЛицо"
            )

    async def test_version_1_8_nests_classifier_codes_and_periods_filter(self):
        await self._ok(
            await self.c.patch(
                f"{API}/company",
                json={"inn": "305555555", "bank_account": "20208000900123456001"},
            )
        )
        # 1.4, what a real Uzbek copy reads, is 1.5's shape with its own version
        self.assertEqual(find((await self._body("1.4"))[0], "Валюта/Код").text, "860")
        sale = (await self._body("1.8"))[0]
        self.assertEqual(find(sale, "Валюта/ДанныеКлассификатора/Код").text, "860")
        self.assertEqual(
            find(sale, "Контрагент/СтранаРегистрации/ДанныеКлассификатора/Код").text,
            "860",
        )
        yesterday = self.today - dt.timedelta(days=1)
        self.assertEqual(len(await self._body(day=yesterday)), 0)
        r = await self.c.get(
            f"{API}/onec/export",
            params={"date_from": self.today, "date_to": yesterday},
        )
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
