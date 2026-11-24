import random
import string
import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import httpx
from sqlalchemy import text

import app.crud.rates as rates
from app.core.cbu import parse_cbu
from app.core import clock
from app.core.database import db_helper
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


class ParseCbuTest(unittest.TestCase):
    def test_rate_is_per_one_unit_and_bad_rows_are_skipped(self):
        rows = parse_cbu(
            [
                {
                    "Ccy": "USD",
                    "Nominal": "1",
                    "Rate": "12010.45",
                    "Date": "18.11.2026",
                },
                {"Ccy": "IDR", "Nominal": "10", "Rate": "6.58", "Date": "18.11.2026"},
                {"Ccy": "XXX", "Nominal": "0", "Rate": "1", "Date": "18.11.2026"},
                {"Ccy": "EUR", "Rate": "13200"},
            ]
        )
        self.assertEqual(
            [(c, str(r), d.isoformat()) for c, r, d in rows],
            [("USD", "12010.450000", "2026-11-18"), ("IDR", "0.658000", "2026-11-18")],
        )


def _code() -> str:
    # a made-up currency per test, so tests sharing the public rate table don't meet
    return "Q" + "".join(random.choices(string.ascii_uppercase, k=2))


@needs_db
class RatesApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        rates._last_try = None
        self.today = datetime.now(clock.TASHKENT).date()
        # the official table is shared; start each test without today's rates so a fetch happens
        async with db_helper.session_factory() as s:
            await s.execute(
                text("DELETE FROM cbu_rate WHERE date >= :d"), {"d": self.today}
            )
            await s.commit()
        self.code = _code()
        self.a = await self._company()

    async def asyncTearDown(self):
        await self.a.aclose()
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
        r = await client.post(
            f"{API}/price-lists", json={"name": "Diler", "currency": self.code}
        )
        self.assertEqual(r.status_code, 201)
        return client

    def _feed(self, rate="12010.45"):
        return AsyncMock(return_value=[(self.code, Decimal(rate), self.today)])

    async def _rate(self, client):
        body = (await client.get(f"{API}/exchange-rates")).json()
        self.assertEqual(body["base"], "UZS")
        return next(r for r in body["rates"] if r["currency"] == self.code)

    async def test_official_rate_is_fetched_once_a_day(self):
        feed = self._feed()
        # a server that started seconds ago (monotonic time near zero) must still fetch
        with (
            patch.object(rates, "fetch_cbu", feed),
            patch.object(rates, "_clock", lambda: 5.0),
        ):
            first = await self._rate(self.a)
            await self._rate(self.a)
        self.assertEqual(
            (first["rate"], first["source"], first["cbu_date"]),
            ("12010.450000", "cbu", self.today.isoformat()),
        )
        self.assertEqual(feed.await_count, 1)

    async def test_another_currency_dated_today_does_not_stop_the_fetch(self):
        async with db_helper.session_factory() as session:
            await session.execute(
                text("INSERT INTO cbu_rate (currency, rate, date) VALUES (:c, 1, :d)"),
                {"c": _code(), "d": self.today},
            )
            await session.commit()
        feed = self._feed()
        with patch.object(rates, "fetch_cbu", feed):
            got = await self._rate(self.a)
        self.assertEqual((got["source"], feed.await_count), ("cbu", 1))

    async def test_company_rate_wins_and_can_be_removed(self):
        with patch.object(rates, "fetch_cbu", self._feed()):
            r = await self.a.put(
                f"{API}/exchange-rates/{self.code}", json={"rate": "12850"}
            )
            self.assertEqual(r.status_code, 204)
            mine = await self._rate(self.a)
            self.assertEqual(
                (mine["rate"], mine["source"], mine["cbu_rate"]),
                ("12850.000000", "company", "12010.450000"),
            )
            # another company with the same currency still sees the official rate
            b = await self._company()
            self.assertEqual((await self._rate(b))["source"], "cbu")
            await b.aclose()
            r = await self.a.delete(f"{API}/exchange-rates/{self.code}")
            self.assertEqual(r.status_code, 204)
            self.assertEqual((await self._rate(self.a))["source"], "cbu")

    async def test_feed_down_gives_no_rate_and_waits_before_trying_again(self):
        feed = AsyncMock(side_effect=httpx.ConnectError("offline"))
        with patch.object(rates, "fetch_cbu", feed):
            r = await self._rate(self.a)
            await self._rate(self.a)
        self.assertEqual((r["rate"], r["source"]), (None, None))
        self.assertEqual(feed.await_count, 1)

    async def test_bad_rates_are_422(self):
        for currency, body in [
            ("UZS", {"rate": "1"}),  # the main currency has no rate
            (self.code, {"rate": "0"}),
            (self.code, {"rate": "-5"}),
        ]:
            r = await self.a.put(f"{API}/exchange-rates/{currency}", json=body)
            self.assertEqual(r.status_code, 422, (currency, body))


if __name__ == "__main__":
    unittest.main()
