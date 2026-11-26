import unittest

import httpx

from app.core.database import db_helper
from app.core.permissions import DEFAULT_ROLES
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class MoneyApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()

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

    async def _move(self, kind, amount, code=201, client=None, **extra):
        body = {
            "kind": kind,
            "place": "cash",
            "currency": "UZS",
            "amount": amount,
            **extra,
        }
        return await self._ok(
            await (client or self.a).post(f"{API}/money-moves", json=body), code
        )

    async def _money(self, client=None, **params):
        return await self._ok(
            await (client or self.a).get(f"{API}/money", params=params)
        )

    async def _balances(self):
        return {
            (b["place"], b["currency"]): b["amount"]
            for b in (await self._money())["balances"]
        }

    async def _customer_pays(self, amount, method):
        customer = await self._ok(
            await self.a.post(f"{API}/customers", json={"name": f"Mijoz {method}"}),
            201,
        )
        return await self._ok(
            await self.a.post(
                f"{API}/payments",
                json={
                    "customer_id": customer["id"],
                    "amount": amount,
                    "currency": "UZS",
                    "method": method,
                },
            ),
            201,
        )

    async def _supplier_paid(self, amount, method):
        supplier = await self._ok(
            await self.a.post(f"{API}/suppliers", json={"name": "Tegirmon"}), 201
        )
        return await self._ok(
            await self.a.post(
                f"{API}/supplier-payments",
                json={
                    "supplier_id": supplier["id"],
                    "amount": amount,
                    "currency": "UZS",
                    "method": method,
                },
            ),
            201,
        )

    # ---------- what is where ----------

    async def test_payments_land_in_the_cash_box_or_the_bank_by_their_method(self):
        await self._customer_pays("1000", "cash")
        await self._customer_pays("500", "transfer")
        await self._customer_pays("300", "card")
        await self._customer_pays("200", "online")
        await self._supplier_paid("400", "cash")
        paid = await self._supplier_paid("250", "transfer")
        self.assertEqual(
            await self._balances(),
            {("cash", "UZS"): "600.00", ("bank", "UZS"): "750.00"},
        )
        await self._ok(
            await self.a.post(f"{API}/supplier-payments/{paid['id']}/cancel")
        )
        self.assertEqual((await self._balances())[("bank", "UZS")], "1000.00")

    async def test_an_expense_takes_money_out_and_other_money_in_adds_it(self):
        await self._move("income", "5000", category="opening")
        expense = await self._move(
            "expense", "1200", category="rent", note="Noyabr", date="2026-11-01"
        )
        self.assertEqual(expense["number"], 2)
        self.assertEqual(expense["date"], "2026-11-01")
        self.assertEqual(await self._balances(), {("cash", "UZS"): "3800.00"})
        page = await self._money(kind="expense")
        self.assertEqual(page["total"], 1)
        row = page["items"][0]
        self.assertEqual(
            (row["source"], row["amount"], row["category"], row["note"]),
            ("money_move", "-1200.00", "rent", "Noyabr"),
        )
        self.assertEqual(
            page["sums"], [{"currency": "UZS", "incoming": "0", "outgoing": "1200.00"}]
        )

    async def test_a_category_must_fit_its_kind(self):
        for kind, category in (
            ("expense", "opening"),
            ("income", "rent"),
            ("expense", None),
            ("income", "nonsense"),
        ):
            r = await self._move(kind, "10", code=422, category=category)
            self.assertEqual(r["detail"][0]["loc"][-1], "category")
        await self._move("expense", "0", code=422, category="rent")

    async def test_a_cancelled_move_stays_in_the_list_and_stops_counting(self):
        move = await self._move("expense", "700", category="taxes")
        for _ in range(2):  # a second cancel changes nothing
            done = await self._ok(
                await self.a.post(f"{API}/money-moves/{move['id']}/cancel")
            )
            self.assertIsNotNone(done["cancelled_at"])
        self.assertEqual(await self._balances(), {})
        page = await self._money()
        self.assertEqual(page["total"], 1)
        self.assertIsNotNone(page["items"][0]["cancelled_at"])
        self.assertEqual(page["sums"], [])
        feed = await self._ok(
            await self.a.get(
                f"{API}/activity",
                params={"entity": "money_move", "entity_id": move["id"]},
            )
        )
        self.assertEqual([a["action"] for a in feed], ["cancelled", "created"])
        self.assertEqual(feed[0]["data"]["category"], "taxes")

    # ---------- moving it ----------

    async def test_cash_carried_to_the_bank_is_neither_money_in_nor_out(self):
        await self._move("income", "1000", category="owner_in")
        await self._move("transfer", "400", to_place="bank")
        self.assertEqual(
            await self._balances(),
            {("cash", "UZS"): "600.00", ("bank", "UZS"): "400.00"},
        )
        page = await self._money()
        self.assertEqual(page["total"], 3)  # the transfer is two lines
        self.assertEqual(
            page["sums"],
            [{"currency": "UZS", "incoming": "1000.00", "outgoing": "0"}],
        )
        # seen from the cash box alone, it did leave
        cash = await self._money(place="cash")
        self.assertEqual(cash["sums"][0]["outgoing"], "400.00")
        out = next(r for r in cash["items"] if r["kind"] == "transfer")
        self.assertEqual((out["amount"], out["other_place"]), ("-400.00", "bank"))

    async def test_an_exchange_leaves_one_currency_and_arrives_in_the_other(self):
        await self._move("income", "100", category="opening", currency="USD", code=422)
        await self._ok(
            await self.a.put(f"{API}/exchange-rates/USD", json={"rate": "12850"}), 204
        )
        opened = await self._move("income", "100", category="opening", currency="USD")
        self.assertEqual(opened["exchange_rate"], "12850.000000")
        r = await self._move(
            "transfer",
            "40",
            code=422,
            currency="USD",
            to_place="cash",
            to_currency="UZS",
        )
        self.assertEqual(r["detail"][0]["loc"][-1], "received")
        await self._move(
            "transfer",
            "40",
            currency="USD",
            to_place="cash",
            to_currency="UZS",
            received="516000",
        )
        self.assertEqual(
            await self._balances(),
            {("cash", "USD"): "60.00", ("cash", "UZS"): "516000.00"},
        )
        # an exchange is real money out of one currency and into the other
        sums = {s["currency"]: s for s in (await self._money())["sums"]}
        self.assertEqual(sums["USD"]["outgoing"], "40.00")
        self.assertEqual(sums["UZS"]["incoming"], "516000.00")

    async def test_a_transfer_needs_somewhere_else_to_go(self):
        r = await self._move("transfer", "10", code=422)
        self.assertEqual(r["detail"][0]["loc"][-1], "to_place")
        r = await self._move("transfer", "10", code=422, to_place="cash")
        self.assertEqual(r["detail"][0]["loc"][-1], "to_place")

    # ---------- the list ----------

    async def test_the_list_filters_by_period_place_and_kind_newest_first(self):
        await self._move("expense", "10", category="rent", date="2026-10-05")
        await self._move("expense", "20", category="salary", date="2026-11-05")
        await self._move(
            "expense", "30", category="taxes", date="2026-11-10", place="bank"
        )
        await self._customer_pays("500", "cash")
        everything = await self._money()
        self.assertEqual(everything["total"], 4)
        self.assertEqual(everything["items"][0]["kind"], "payment")
        self.assertEqual(everything["items"][0]["party"], "Mijoz cash")
        november = await self._money(
            date_from="2026-11-01", date_to="2026-11-30", kind="expense", sort="date"
        )
        self.assertEqual([r["amount"] for r in november["items"]], ["-20.00", "-30.00"])
        bank = await self._money(place="bank")
        self.assertEqual([r["category"] for r in bank["items"]], ["taxes"])
        paged = await self._money(limit=1, offset=1)
        self.assertEqual((len(paged["items"]), paged["total"]), (1, 4))

    async def test_the_excel_file_downloads(self):
        await self._move("income", "1000", category="opening")
        await self._move("transfer", "100", to_place="bank")
        await self._customer_pays("5", "cash")
        r = await self.a.get(f"{API}/money/export", params={"lang": "ru"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.content.startswith(b"PK"))

    # ---------- who may ----------

    async def test_another_company_never_sees_or_cancels_our_money(self):
        move = await self._move("income", "900", category="opening")
        theirs = await self._money(self.b)
        self.assertEqual((theirs["total"], theirs["balances"]), (0, []))
        await self._ok(await self.b.post(f"{API}/money-moves/{move['id']}/cancel"), 404)
        self.assertEqual(await self._balances(), {("cash", "UZS"): "900.00"})

    async def test_a_storekeeper_sees_no_money(self):
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
        await self._ok(await keeper.get(f"{API}/money"), 403)
        await self._ok(await keeper.get(f"{API}/money/export"), 403)
        await self._move("expense", "1", code=403, client=keeper, category="rent")
