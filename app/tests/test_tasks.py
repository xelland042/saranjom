import unittest
from datetime import timedelta

import httpx

from app.core.database import db_helper
from app.crud.debts import today
from app.main import main_app
from app.tests.db import needs_db, random_ip, random_phone

API = "/api/v1"


@needs_db
class TasksApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.a = await self._company()
        self.b = await self._company()
        self.customer = await self._ok(
            await self.a.post(f"{API}/customers", json={"name": "Baraka Market"}), 201
        )

    async def asyncTearDown(self):
        await self.a.aclose()
        await self.b.aclose()
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
        return client

    async def _ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    async def _task(self, title, days=None, code=201, **extra):
        body = {"title": title, **extra}
        if days is not None:
            body["due_date"] = (today() + timedelta(days=days)).isoformat()
        return await self._ok(await self.a.post(f"{API}/tasks", json=body), code)

    async def _titles(self, **params):
        page = await self._ok(await self.a.get(f"{API}/tasks", params=params))
        return [t["title"] for t in page["items"]]

    async def test_open_tasks_most_urgent_first_and_the_dock_count(self):
        await self._task("someday")
        await self._task("tomorrow", 1)
        await self._task("today, later", 0, due_time="17:00")
        await self._task("today", 0)
        await self._task("late", -3)
        self.assertEqual(
            await self._titles(),
            ["late", "today", "today, later", "tomorrow", "someday"],
        )
        summary = await self._ok(await self.a.get(f"{API}/tasks/summary"))
        self.assertEqual(summary, {"overdue": 1, "today": 2})

    async def test_ticking_off_and_back(self):
        t = await self._task("call", 0)
        url = f"{API}/tasks/{t['id']}"
        done = await self._ok(await self.a.patch(url, json={"done": True}))
        self.assertIsNotNone(done["done_at"])
        self.assertEqual(await self._titles(), [])
        self.assertEqual(await self._titles(view="done"), ["call"])
        self.assertEqual(
            (await self._ok(await self.a.get(f"{API}/tasks/summary")))["today"], 0
        )
        back = await self._ok(await self.a.patch(url, json={"done": False}))
        self.assertIsNone(back["done_at"])

    async def test_linked_to_a_customer_and_filtered_by_it(self):
        t = await self._task("debt", 0, customer_id=self.customer["id"])
        self.assertEqual(t["customer_name"], "Baraka Market")
        self.assertIsNotNone(t["assignee_id"])
        await self._task("other")
        self.assertEqual(await self._titles(customer_id=self.customer["id"]), ["debt"])

    async def test_edit_and_delete(self):
        t = await self._task("call", 0, due_time="10:30")
        url = f"{API}/tasks/{t['id']}"
        edited = await self._ok(
            await self.a.patch(
                url, json={"title": "visit", "due_date": None, "due_time": None}
            )
        )
        self.assertEqual((edited["title"], edited["due_date"]), ("visit", None))
        # a time without a day means nothing
        self.assertEqual(
            (await self.a.patch(url, json={"due_time": "09:00"})).status_code, 422
        )
        self.assertEqual((await self.a.delete(url)).status_code, 204)
        self.assertEqual((await self.a.get(url)).status_code, 404)

    async def _stages(self, client=None):
        return await self._ok(await (client or self.a).get(f"{API}/task-stages"))

    async def _board(self):
        page = await self._ok(
            await self.a.get(f"{API}/tasks", params={"view": "board"})
        )
        names = {st["id"]: st["name"] for st in await self._stages()}
        cols = {}
        for t in page["items"]:
            cols.setdefault(names[t["stage_id"]], []).append(t["title"])
        return cols

    async def test_a_new_company_starts_with_three_columns(self):
        self.assertEqual(
            [(s["name"], s["color"], s["done"]) for s in await self._stages()],
            [
                ("Qilinadi", "gray", False),
                ("Jarayonda", "blue", False),
                ("Bajarildi", "green", True),
            ],
        )

    async def test_the_board_moves_cards_between_columns_and_within_them(self):
        todo, doing, done_col = [s["id"] for s in await self._stages()]
        a = await self._task("a")
        b = await self._task("b")  # new cards go on top of their column
        await self._task("c", stage_id=doing, priority="urgent")
        self.assertEqual(
            await self._board(), {"Qilinadi": ["b", "a"], "Jarayonda": ["c"]}
        )
        url = f"{API}/tasks/{a['id']}"
        await self._ok(await self.a.patch(url, json={"position": b["position"] - 1}))
        self.assertEqual((await self._board())["Qilinadi"], ["a", "b"])
        started = await self._ok(await self.a.patch(url, json={"stage_id": doing}))
        self.assertEqual((started["stage_id"], started["done_at"]), (doing, None))
        # into a done column: ticked off, out of the open list, still on the board
        done = await self._ok(await self.a.patch(url, json={"stage_id": done_col}))
        self.assertIsNotNone(done["done_at"])
        self.assertNotIn("a", await self._titles())
        self.assertIn("a", (await self._board())["Bajarildi"])
        # "done: false" goes back to the first open column
        back = await self._ok(await self.a.patch(url, json={"done": False}))
        self.assertEqual((back["stage_id"], back["done_at"]), (todo, None))
        self.assertEqual(await self._titles(priority="urgent"), ["c"])
        self.assertEqual(await self._titles(q="B"), ["b"])
        history = await self._ok(
            await self.a.get(
                f"{API}/activity", params={"entity": "task", "entity_id": a["id"]}
            )
        )
        self.assertEqual(
            [(h["action"], h["data"].get("stage")) for h in history],
            [
                ("reopened", "Qilinadi"),
                ("done", "Bajarildi"),
                ("moved", "Jarayonda"),
                ("created", None),
            ],
        )
        self.assertEqual(
            (await self.a.patch(url, json={"stage_id": 999999999})).status_code, 422
        )

    async def test_columns_are_the_companys_own(self):
        todo, doing, done_col = [s["id"] for s in await self._stages()]
        review = await self._ok(
            await self.a.post(
                f"{API}/task-stages", json={"name": "Tekshiruvda", "color": "violet"}
            ),
            201,
        )
        self.assertEqual(
            [s["name"] for s in await self._stages()],
            ["Qilinadi", "Jarayonda", "Bajarildi", "Tekshiruvda"],
        )
        # moved between "Jarayonda" and "Bajarildi"
        await self._ok(
            await self.a.patch(
                f"{API}/task-stages/{review['id']}", json={"position": 1536}
            )
        )
        self.assertEqual([s["name"] for s in await self._stages()][2], "Tekshiruvda")
        self.assertEqual(
            (
                await self.a.post(f"{API}/task-stages", json={"name": "Tekshiruvda"})
            ).status_code,
            409,
        )
        t = await self._task("x", stage_id=review["id"])
        # a column turned into a done one finishes its cards
        await self._ok(
            await self.a.patch(f"{API}/task-stages/{review['id']}", json={"done": True})
        )
        self.assertIsNotNone(
            (await self._ok(await self.a.get(f"{API}/tasks/{t['id']}")))["done_at"]
        )
        # a column with cards needs somewhere for them to go
        url = f"{API}/task-stages/{review['id']}"
        self.assertEqual((await self.a.delete(url)).status_code, 422)
        self.assertEqual(
            (await self.a.delete(url, params={"move_to": todo})).status_code, 204
        )
        moved = await self._ok(await self.a.get(f"{API}/tasks/{t['id']}"))
        self.assertEqual((moved["stage_id"], moved["done_at"]), (todo, None))
        # the last done column stays, and so does the last open one
        self.assertEqual(
            (await self.a.delete(f"{API}/task-stages/{done_col}")).status_code, 422
        )
        await self.a.delete(f"{API}/task-stages/{doing}")
        r = await self.a.patch(f"{API}/task-stages/{todo}", json={"done": True})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(
            (
                await self.a.post(
                    f"{API}/task-stages", json={"name": "x", "color": "pink"}
                )
            ).status_code,
            422,
        )
        # another company sees and touches none of it
        self.assertEqual(len(await self._stages(self.b)), 3)
        self.assertEqual(
            (await self.b.delete(f"{API}/task-stages/{todo}")).status_code, 404
        )
        r = await self.b.post(f"{API}/tasks", json={"title": "x", "stage_id": todo})
        self.assertEqual(r.status_code, 422)

    async def test_due_filters(self):
        await self._task("late", -2)
        await self._task("now", 0)
        await self._task("soon", 3)
        await self._task("far", 30)
        self.assertEqual(await self._titles(due="overdue"), ["late"])
        self.assertEqual(await self._titles(due="today"), ["now"])
        self.assertEqual(await self._titles(due="week"), ["now", "soon"])

    async def test_bad_input_is_422(self):
        for body in [
            {"title": " "},
            {"title": "x", "due_time": "10:00"},
            {"title": "x", "customer_id": 999999999},
            {"title": "x", "order_id": 999999999},
        ]:
            r = await self.a.post(f"{API}/tasks", json=body)
            self.assertEqual(r.status_code, 422, body)
        t = await self._task("x")
        r = await self.a.patch(f"{API}/tasks/{t['id']}", json={"title": None})
        self.assertEqual(r.status_code, 422)

    async def test_other_company_cannot_see_or_use(self):
        t = await self._task("secret", 0)
        url = f"{API}/tasks/{t['id']}"
        page = await self._ok(await self.b.get(f"{API}/tasks"))
        self.assertEqual(page["total"], 0)
        self.assertEqual(
            await self._ok(await self.b.get(f"{API}/tasks/summary")),
            {"overdue": 0, "today": 0},
        )
        for r in [
            await self.b.get(url),
            await self.b.patch(url, json={"done": True}),
            await self.b.delete(url),
        ]:
            self.assertEqual(r.status_code, 404)
        r = await self.b.post(
            f"{API}/tasks", json={"title": "x", "customer_id": self.customer["id"]}
        )
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
