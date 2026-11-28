import unittest
from unittest.mock import patch

import httpx

from app.core.clock import today
from app.core.config import settings
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

    async def test_one_address_can_only_sign_up_so_many_companies(self):
        with patch.object(settings.auth, "signups_per_hour", 2):
            codes = [
                (await self._signup(self.client, random_phone())).status_code
                for _ in range(3)
            ]
            # another address isn't held back by the first one
            async with self._client() as other:
                elsewhere = (await self._signup(other, random_phone())).status_code
        self.assertEqual(codes, [201, 201, 429])
        self.assertEqual(elsewhere, 201)

    async def test_a_burst_from_one_address_is_refused_before_any_password_is_checked(
        self,
    ):
        phone = random_phone()
        await self._signup(self.client, phone)
        right = {"login": phone, "password": "secret-123"}
        with patch.object(settings.auth, "requests_per_minute", 3):
            async with self._client() as c:
                codes = [
                    (await c.post(f"{API}/login", json=right)).status_code
                    for _ in range(4)
                ]
        # the right password, so only the count of requests can have refused the fourth
        self.assertEqual(codes, [200, 200, 200, 429])

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

    async def _guest(self, permissions, login):
        """A person of the client's company with a role of these permissions."""
        role = await self.client.post(
            "/api/v1/roles", json={"name": "Mehmon", "permissions": permissions}
        )
        self.assertEqual(role.status_code, 201, role.text)
        r = await self.client.post(
            "/api/v1/staff",
            json={
                "name": "Mehmon",
                "login": login,
                "password": "nobody-knows-1",
                "role_id": role.json()["id"],
            },
        )
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    async def test_the_demo_lets_anyone_in_as_its_guest_who_only_looks(self):
        visitor = self._client()
        # no demo set up: the login screen offers none and the door is shut
        self.assertEqual(
            (await visitor.get(f"{API}/demo")).json(), {"available": False}
        )
        self.assertEqual((await visitor.post(f"{API}/demo")).status_code, 404)

        await self._signup(self.client, random_phone())
        login = f"guest{random_phone()[5:]}"
        guest = await self._guest(["customers.read", "money.read", "dashboard"], login)
        with patch.object(settings.auth, "demo_login", login.upper()):
            self.assertEqual(
                (await visitor.get(f"{API}/demo")).json(), {"available": True}
            )
            self.assertEqual((await visitor.post(f"{API}/demo")).status_code, 200)
            me = (await visitor.get(f"{API}/me")).json()
            self.assertEqual((me["id"], me["owner"]), (guest["id"], False))
            # looking works, changing doesn't
            r = await visitor.get("/api/v1/customers")
            self.assertEqual(r.status_code, 200)
            # the overview keeps the company's tasks from a role that doesn't see tasks
            r = await self.client.post(
                "/api/v1/tasks", json={"title": "Call", "due_date": str(today())}
            )
            self.assertEqual(r.status_code, 201, r.text)
            ours = (await self.client.get("/api/v1/dashboard")).json()["tasks"]
            self.assertEqual((ours["today"], len(ours["items"])), (1, 1))
            theirs = (await visitor.get("/api/v1/dashboard")).json()["tasks"]
            self.assertEqual(theirs, {"overdue": 0, "today": 0, "items": []})
            r = await visitor.post("/api/v1/customers", json={"name": "X"})
            self.assertEqual(r.status_code, 403)
            # turned off by the owner, the guest is no way in
            await visitor.post(f"{API}/logout")
            r = await self.client.patch(
                f"/api/v1/staff/{guest['id']}", json={"active": False}
            )
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual((await visitor.post(f"{API}/demo")).status_code, 404)
        await visitor.aclose()

    async def test_the_demo_never_opens_an_account_that_can_change_things(self):
        phone = random_phone()
        await self._signup(self.client, phone)
        login = f"guest{random_phone()[5:]}"
        await self._guest(["customers.read", "customers.write"], login)
        async with self._client() as visitor:
            # the owner, a role that changes customers, a login nobody has
            for name in (phone, login, "nobody-here"):
                with patch.object(settings.auth, "demo_login", name):
                    r = await visitor.post(f"{API}/demo")
                    self.assertEqual(r.status_code, 404, name)
                    self.assertEqual((await visitor.get(f"{API}/me")).status_code, 401)

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
