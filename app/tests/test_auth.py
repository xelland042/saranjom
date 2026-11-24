import unittest

import httpx

from app.core.database import db_helper
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1/auth"


@needs_db
class AuthFlowTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = self._client()

    async def asyncTearDown(self):
        await self.client.aclose()
        await db_helper.dispose()

    def _client(self):
        # a fresh IP per client, so failed logins in one test can't rate-limit another
        transport = httpx.ASGITransport(app=main_app, client=(random_ip(), 1234))
        return httpx.AsyncClient(transport=transport, base_url="https://test")

    async def _signup(self, client, login, company="Gʻalla Savdo"):
        return await client.post(
            f"{API}/signup",
            json={
                "company_name": company,
                "name": "Rustam",
                "login": login,
                "password": "secret-123",
            },
        )

    async def test_signup_logs_in_and_normalizes_phone(self):
        phone = random_phone()
        local = (
            f"{phone[4:6]} {phone[6:9]} {phone[9:11]} {phone[11:]}"  # "90 123 45 67"
        )
        self.assertEqual((await self._signup(self.client, local)).status_code, 201)
        me = (await self.client.get(f"{API}/me")).json()
        self.assertEqual(me["phone"], phone)
        self.assertEqual(me["company_name"], "Gʻalla Savdo")
        self.assertTrue(me["owner"])

    async def test_login_with_phone_email_or_username(self):
        phone = random_phone()
        for login, typed in [
            (phone, phone.replace("+", "")),
            (f"u{phone[5:]}@mail.uz", f"U{phone[5:]}@Mail.uz"),
            (f"user{phone[5:]}", f"User{phone[5:]}"),
        ]:
            async with self._client() as c:
                self.assertEqual((await self._signup(c, login)).status_code, 201)
            async with self._client() as c:
                r = await c.post(
                    f"{API}/login", json={"login": typed, "password": "secret-123"}
                )
                self.assertEqual(r.status_code, 200, login)
                self.assertEqual((await c.get(f"{API}/me")).status_code, 200)

    async def test_wrong_password_and_unknown_login_look_the_same(self):
        phone = random_phone()
        await self._signup(self.client, phone)
        async with self._client() as c:
            wrong = await c.post(
                f"{API}/login", json={"login": phone, "password": "nope"}
            )
            unknown = await c.post(
                f"{API}/login", json={"login": random_phone(), "password": "nope"}
            )
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.json(), wrong.json())

    async def test_taken_login_is_409(self):
        phone = random_phone()
        await self._signup(self.client, phone)
        async with self._client() as c:
            self.assertEqual((await self._signup(c, phone)).status_code, 409)

    async def test_bad_login_format_is_422(self):
        self.assertEqual((await self._signup(self.client, "12345")).status_code, 422)

    async def test_logout_ends_the_session(self):
        await self._signup(self.client, random_phone())
        token = self.client.cookies.get("session")
        await self.client.post(f"{API}/logout")
        self.assertEqual((await self.client.get(f"{API}/me")).status_code, 401)
        # the old cookie value no longer works either
        async with self._client() as c:
            c.cookies.set("session", token)
            self.assertEqual((await c.get(f"{API}/me")).status_code, 401)

    async def test_each_user_sees_own_company(self):
        async with self._client() as a, self._client() as b:
            await self._signup(a, random_phone(), company="A")
            await self._signup(b, random_phone(), company="B")
            self.assertEqual((await a.get(f"{API}/me")).json()["company_name"], "A")
            self.assertEqual((await b.get(f"{API}/me")).json()["company_name"], "B")

    async def test_too_many_failures_are_429(self):
        phone = random_phone()
        await self._signup(self.client, phone)
        async with self._client() as c:
            for _ in range(10):
                await c.post(f"{API}/login", json={"login": phone, "password": "nope"})
            right = await c.post(
                f"{API}/login", json={"login": phone, "password": "secret-123"}
            )
        self.assertEqual(right.status_code, 429)

    async def test_changing_your_password_logs_out_your_other_sessions(self):
        phone = random_phone()
        await self._signup(self.client, phone)
        other = self._client()
        r = await other.post(
            f"{API}/login", json={"login": phone, "password": "secret-123"}
        )
        self.assertEqual(r.status_code, 200)
        url = f"{API}/password"
        wrong = await self.client.post(
            url, json={"current": "nope", "new": "fresh-pass"}
        )
        self.assertEqual(wrong.status_code, 422)
        self.assertEqual(wrong.json()["detail"][0]["loc"], ["body", "current"])
        short = await self.client.post(url, json={"current": "secret-123", "new": "x"})
        self.assertEqual(short.status_code, 422)
        r = await self.client.post(
            url, json={"current": "secret-123", "new": "fresh-pass"}
        )
        self.assertEqual(r.status_code, 200)
        # this session goes on, the other one is over
        self.assertEqual((await self.client.get(f"{API}/me")).status_code, 200)
        self.assertEqual((await other.get(f"{API}/me")).status_code, 401)
        await other.aclose()
        async with self._client() as c:
            old = await c.post(
                f"{API}/login", json={"login": phone, "password": "secret-123"}
            )
            new = await c.post(
                f"{API}/login", json={"login": phone, "password": "fresh-pass"}
            )
        self.assertEqual((old.status_code, new.status_code), (401, 200))

    async def test_guessing_the_current_password_is_limited(self):
        await self._signup(self.client, random_phone())
        codes = [
            (
                await self.client.post(
                    f"{API}/password", json={"current": "nope", "new": "fresh-pass"}
                )
            ).status_code
            for _ in range(11)
        ]
        self.assertEqual(codes[-1], 429)
        self.assertEqual(set(codes[:-1]), {422})

    async def test_not_logged_in_is_401(self):
        self.assertEqual((await self.client.get(f"{API}/me")).status_code, 401)


if __name__ == "__main__":
    unittest.main()
