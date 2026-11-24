"""A demo company with two months of believable activity, to try every screen.

    cd app && poetry run python -m app.scripts.seed_demo        (from the repo root:
    poetry run python -m app.scripts.seed_demo)

Everything goes through the app's own API (in-process, no server needed), so stock, debts,
overdue sums and the history come out exactly as real use would make them. Dates are spread over
the last 60 days and end today. Run it again and it stops: the demo login already exists (sign up
another company in the app, or empty the database, for a fresh one).

Demo logins, all with the password demo-12345 (development only: a server sets its own in
DEMO_PASSWORD):
    demo (owner), menejer (manager), omborchi (storekeeper), buxgalter (accountant)
Run on a database where the demo company exists, it adds any of these people still missing.
"""

import asyncio
import os
import random
from datetime import timedelta

import httpx

from app.core.clock import today
from app.core.database import db_helper
from app.core.permissions import DEFAULT_ROLES
from app.main import main_app

API = "/api/v1"
LOGIN = "demo"
PASSWORD = os.environ.get("DEMO_PASSWORD") or "demo-12345"
TODAY = today()  # the app's day (Tashkent), like the documents it makes
rnd = random.Random(20261120)  # the same demo every run


def day(n: int) -> str:
    """n days ago, as the API takes dates."""
    return (TODAY - timedelta(days=n)).isoformat()


class Demo:
    def __init__(self, client: httpx.AsyncClient):
        self.c = client

    async def call(self, method: str, path: str, body=None, **params):
        r = await self.c.request(
            method, f"{API}{path}", json=body, params=params or None
        )
        if r.status_code >= 400:
            raise SystemExit(f"{method} {path} -> {r.status_code}: {r.text}")
        return r.json() if r.content else None

    async def post(self, path, body):
        return await self.call("POST", path, body)


CATEGORIES = [
    "Un mahsulotlari",
    "Yogʻ va shakar",
    "Ichimliklar",
    "Konservalar",
    "Gigiyena",
]
# name, sku, unit, category index, retail price (soʻm), minimum stock
PRODUCTS = [
    ("Un oliy nav 50 kg", "UN-50", "bag", 0, 385_000, 60),
    ("Un 1-nav 50 kg", "UN1-50", "bag", 0, 340_000, 30),
    ("Makaron 5 kg", "MK-5", "pcs", 0, 62_000, 40),
    ("Guruch lazer 25 kg", "GR-25", "bag", 0, 420_000, None),
    ("Grechka 10 kg", "GRE-10", "bag", 0, 155_000, None),
    ("Kungaboqar yogʻi 5 l", "YOG-5", "pcs", 1, 98_000, 50),
    ("Paxta yogʻi 10 l", "PYOG-10", "pcs", 1, 185_000, None),
    ("Shakar 50 kg", "SH-50", "bag", 1, 610_000, 20),
    ("Shakar 1 kg", "SH-1", "pcs", 1, 13_500, None),
    ("Choy qora 100 g", "CH-100", "pack", 2, 18_000, None),
    ("Choy yashil 100 g", "CHY-100", "pack", 2, 16_500, None),
    ("Mineral suv 1.5 l", "SUV-15", "box", 2, 36_000, None),
    ("Sharbat 1 l", "SHB-1", "box", 2, 96_000, None),
    ("Tomat pastasi 800 g", "TP-800", "box", 3, 168_000, None),
    ("Noʻxat konserva", "NX-400", "box", 3, 132_000, None),
    ("Sut quyultirilgan", "SQ-380", "box", 3, 210_000, None),
    ("Kir yuvish kukuni 3 kg", "KK-3", "pcs", 4, 74_000, None),
    ("Sovun 90 g", "SV-90", "box", 4, 88_000, None),
    ("Idish yuvish vositasi", "IY-1", "box", 4, 102_000, None),
    ("Tish pastasi", "TP-100", "box", 4, 145_000, None),
]
# name, ИНН, phone, district, payment days, how they pay, price list ("main", "bulk", "usd")
CUSTOMERS = [
    (
        "Baraka Market MChJ",
        "305112233",
        "+998901112233",
        "Chilonzor",
        10,
        "late",
        "main",
    ),
    ("Oila Supermarket", "307998877", "+998977778899", "Yunusobod", 7, "good", "main"),
    ("Hamkor Savdo MChJ", "308223344", "+998946665544", "Sergeli", 30, "good", "bulk"),
    ("Temir Diler", "306445566", "+998935556677", "Olmazor", 14, "good", "usd"),
    ("Nonvoyxona Sharq", None, "+998911234567", "Shayxontohur", 0, "good", "main"),
    (
        "Toshkent Oziq-ovqat MChJ",
        "309334455",
        "+998712345678",
        "Mirzo Ulugʻbek",
        15,
        "bad",
        "bulk",
    ),
    ("Navroʻz Doʻkoni", None, "+998903216547", "Bektemir", 5, "late", "main"),
    (
        "Samarqand Savdo Uyi",
        "310556677",
        "+998662223344",
        "Samarqand",
        21,
        "good",
        "bulk",
    ),
    ("Mehribon Kafe", "311667788", "+998974445566", "Yakkasaroy", 7, "good", "main"),
    ("Chorsu Ulgurji", "312778899", "+998937778899", "Chorsu", 14, "late", "bulk"),
    ("Fargʻona Market", "313889900", "+998732224455", "Fargʻona", 20, "bad", "main"),
    (
        "Yangi Hayot MChJ",
        "314990011",
        "+998951112244",
        "Yangihayot",
        10,
        "good",
        "main",
    ),
]
CONTACTS = {
    "Baraka Market MChJ": [
        ("Akmal Karimov", "+998901234567", "Direktor"),
        ("Dilnoza", "+998907654321", "Buxgalter"),
    ],
    "Hamkor Savdo MChJ": [("Jasur Toshmatov", "+998946660011", "Taʼminotchi")],
    "Temir Diler": [("Temur Aliyev", "+998935550000", "Rahbar")],
    "Toshkent Oziq-ovqat MChJ": [("Sardor", "+998712340000", "Omborchi")],
}


async def seed(demo: Demo) -> None:
    lists = await demo.call("GET", "/price-lists")
    main = lists[0]
    bulk = await demo.post("/price-lists", {"name": "Ulgurji", "currency": "UZS"})
    usd = await demo.post("/price-lists", {"name": "Diler USD", "currency": "USD"})
    # the company's own rate, so foreign prices work offline too (the Central Bank's when online)
    await demo.call("PUT", "/exchange-rates/USD", {"rate": "12850"})
    await demo.post("/vat-rates", {"rate": "12", "valid_from": f"{TODAY.year}-01-01"})

    cats = [await demo.post("/product-categories", {"name": n}) for n in CATEGORIES]
    main_wh = (await demo.call("GET", "/warehouses"))[0]
    second_wh = await demo.post("/warehouses", {"name": "Sergeli ombori"})

    products = []
    for name, sku, unit, cat, price, minimum in PRODUCTS:
        p = await demo.post(
            "/products",
            {
                "name": name,
                "sku": sku,
                "unit": unit,
                "category_id": cats[cat]["id"],
                "min_stock": str(minimum) if minimum else None,
                "prices": [
                    {"price_list_id": main["id"], "amount": str(price)},
                    {
                        "price_list_id": bulk["id"],
                        "amount": str(round(price * 0.95, -2)),
                    },
                    {
                        "price_list_id": usd["id"],
                        "amount": f"{price * 0.93 / 12850:.2f}",
                    },
                ],
            },
        )
        products.append(
            {
                **p,
                "price": {
                    main["id"]: price,
                    bulk["id"]: round(price * 0.95, -2),
                    usd["id"]: round(price * 0.93 / 12850, 2),
                },
            }
        )

    # goods arrive: a big delivery two months ago, smaller ones since; flour also to Sergeli
    for n, share in ((62, 1.0), (40, 0.5), (18, 0.4), (4, 0.3)):
        await demo.post(
            "/stock-documents",
            {
                "kind": "receipt",
                "date": day(n),
                "warehouse_id": main_wh["id"],
                "currency": "UZS",
                "note": "Yetkazib beruvchidan" if n != 62 else "Boshlangʻich kirim",
                "lines": [
                    {
                        "product_id": p["id"],
                        # sugar comes in short, so it goes below zero; pasta runs low
                        "quantity": str(
                            max(
                                1,
                                int(
                                    (
                                        12
                                        if p["sku"] == "SH-50"
                                        else 30 if p["sku"] == "MK-5" else 160
                                    )
                                    * share
                                ),
                            )
                        ),
                        "price": str(round(p["price"][main["id"]] * 0.82, -2)),
                    }
                    for p in products
                ],
            },
        )
    await demo.post(
        "/stock-documents",
        {
            "kind": "transfer",
            "date": day(35),
            "warehouse_id": main_wh["id"],
            "to_warehouse_id": second_wh["id"],
            "lines": [{"product_id": p["id"], "quantity": "25"} for p in products[:4]],
        },
    )
    await demo.post(
        "/stock-documents",
        {
            "kind": "write_off",
            "date": day(12),
            "warehouse_id": main_wh["id"],
            "note": "Namlikdan buzilgan",
            "lines": [{"product_id": products[0]["id"], "quantity": "3"}],
        },
    )

    list_of = {"main": main["id"], "bulk": bulk["id"], "usd": usd["id"]}
    customers = []
    for name, inn, phone, district, days, pays, pl in CUSTOMERS:
        c = await demo.post(
            "/customers",
            {
                "name": name,
                "inn": inn,
                "phone": phone,
                "address": (
                    f"{district}"
                    if district in ("Samarqand", "Fargʻona")
                    else f"Toshkent sh., {district} t."
                ),
                "payment_days": days,
                "price_list_id": list_of[pl] if pl != "main" else None,
                # a tight limit, so confirming one more order shows the warning
                **(
                    {"credit_limit": "8000000", "credit_currency": "UZS"}
                    if name.startswith("Baraka")
                    else {}
                ),
            },
        )
        for cn, cp, pos in CONTACTS.get(name, []):
            await demo.post(
                f"/customers/{c['id']}/contacts",
                {"name": cn, "phone": cp, "position": pos},
            )
        customers.append({**c, "pays": pays, "list": list_of[pl], "days": days})
    # debts from before the company started with Saranjom
    await demo.call(
        "PUT",
        f"/customers/{customers[5]['id']}/opening-balances/UZS",
        {"amount": "4500000", "date": day(70)},
    )
    await demo.call(
        "PUT",
        f"/customers/{customers[10]['id']}/opening-balances/UZS",
        {"amount": "2750000", "date": day(70)},
    )

    # two months of sales: weekdays busier, the first customers the regulars
    weights = [8, 7, 6, 4, 6, 3, 4, 3, 4, 4, 2, 3]
    confirmed = []
    for n in range(58, -1, -1):
        weekday = (TODAY - timedelta(days=n)).weekday()
        for _ in range(rnd.choice([0, 1, 1, 2] if weekday < 5 else [0, 0, 1])):
            c = rnd.choices(customers, weights)[0]
            picked = rnd.sample(products, rnd.randint(1, 4))
            lines = [
                {
                    "product_id": p["id"],
                    "quantity": str(rnd.choice([2, 3, 5, 6, 8, 10, 12, 15, 20])),
                    "price": str(p["price"][c["list"]]),
                    "discount": rnd.choice(["0", "0", "0", "3", "5"]),
                }
                for p in picked
            ]
            o = await demo.post(
                "/orders", {"customer_id": c["id"], "date": day(n), "lines": lines}
            )
            if n <= 1 and rnd.random() < 0.5:
                continue  # today's and yesterday's drafts, still being put together
            o = await demo.call("POST", f"/orders/{o['id']}/confirm")
            if rnd.random() < 0.04:
                await demo.call("POST", f"/orders/{o['id']}/cancel")
                continue
            confirmed.append((n, c, o))

    # money comes in: good payers on time, slow ones late and in part, bad ones barely
    methods = ["cash", "cash", "transfer", "transfer", "card", "online"]
    for n, c, o in confirmed:
        if c["pays"] == "good":
            when, share = n - c["days"] + rnd.randint(-3, 1), 1.0
        elif c["pays"] == "late":
            when, share = n - c["days"] - rnd.randint(5, 15), rnd.choice(
                [0.5, 0.7, 1.0]
            )
        else:
            when, share = n - c["days"] - 20, 0.3
        if when < 0 or rnd.random() < 0.08:
            continue  # not due yet, or simply forgotten
        amount = round(float(o["total"]) * share, 2)
        await demo.post(
            "/payments",
            {
                "customer_id": c["id"],
                "amount": f"{amount:.2f}",
                "currency": o["currency"],
                "method": rnd.choice(methods),
                "date": day(when),
            },
        )

    staff = await add_staff(demo)
    # the task board: a review column of their own, cards in every column
    stages = await demo.call("GET", "/task-stages")
    review = await demo.post("/task-stages", {"name": "Tekshiruvda", "color": "violet"})
    await demo.call(
        "PATCH",
        f"/task-stages/{review['id']}",
        {"position": (stages[1]["position"] + stages[2]["position"]) / 2},
    )
    todo, doing, done = stages[0]["id"], stages[1]["id"], stages[2]["id"]
    late_order = next(o for n, c, o in confirmed if c["pays"] == "bad")
    tasks = [
        (
            "Barakaga qarz boʻyicha qoʻngʻiroq",
            todo,
            "urgent",
            -1,
            customers[0],
            None,
            "Muddati oʻtgan qarz, 3 marta eslatildi",
        ),
        (
            "Toshkent Oziq-ovqat: akt sverki yuborish",
            todo,
            "high",
            0,
            customers[5],
            late_order,
            None,
        ),
        ("Yangi narxlarni dilerlarga yuborish", todo, "normal", 3, None, None, None),
        ("Sergeli omborini sanash", todo, "low", 7, None, None, None),
        (
            "Fargʻona Market bilan uchrashuv",
            doing,
            "high",
            1,
            customers[10],
            None,
            "Qarzni boʻlib toʻlash taklifi",
        ),
        (
            "Shakar yetkazib beruvchisi bilan shartnoma",
            doing,
            "urgent",
            0,
            None,
            None,
            None,
        ),
        (
            "Samarqand Savdo: yangi buyurtma tayyorlash",
            doing,
            "normal",
            2,
            customers[7],
            None,
            None,
        ),
        (
            "Hamkor Savdo hisob-fakturasini tekshirish",
            review["id"],
            "normal",
            -2,
            customers[2],
            None,
            None,
        ),
        (
            "Mehribon Kafe uchun chegirma kelishuvi",
            review["id"],
            "low",
            5,
            customers[8],
            None,
            None,
        ),
        (
            "Oila Supermarket: yetkazib berish manzili",
            done,
            "normal",
            -3,
            customers[1],
            None,
            None,
        ),
        ("Oylik hisobotni tayyorlash", done, "high", -1, None, None, None),
    ]
    # the manager handles customers, the storekeeper the warehouse, the owner the rest
    who = {
        "Sergeli omborini sanash": "omborchi",
        "Shakar yetkazib beruvchisi bilan shartnoma": "omborchi",
    }
    for title, stage, priority, due, c, o, note in tasks:
        login = who.get(title) or ("menejer" if c else None)
        await demo.post(
            "/tasks",
            {
                "assignee_id": staff.get(login) if login else None,
                "title": title,
                "stage_id": stage,
                "priority": priority,
                "due_date": day(-due),
                "due_time": "15:00" if due == 0 else None,
                "customer_id": c["id"] if c else None,
                "order_id": o["id"] if o else None,
                "note": note,
            },
        )
    for c, text in [
        (customers[0], "Qoʻngʻiroq qildim: juma kuni yarmini toʻlashga vaʼda berdi"),
        (
            customers[0],
            "Direktor bilan gaplashildi, keyingi buyurtmalar faqat oldindan toʻlov bilan",
        ),
        (customers[5], "Buxgalteri akt sverkini soʻradi"),
        (customers[3], "Dollar kursi oʻzgarsa, narxlarni qayta koʻrib chiqish kerak"),
    ]:
        await demo.post(f"/customers/{c['id']}/notes", {"text": text})

    print(
        f"Demo company ready: {len(products)} products, {len(customers)} customers, "
        f"{len(confirmed)} confirmed orders, {len(tasks)} tasks."
    )


# login, name, role: the company's staff, one per role
STAFF = [
    ("menejer", "Dilshod Yusupov", "manager"),
    ("omborchi", "Botir Rahimov", "storekeeper"),
    ("buxgalter", "Malika Saidova", "accountant"),
]


async def add_staff(demo: Demo) -> dict[str, int]:
    """The people, added if missing; returns login -> id."""
    # the company's default roles, by their Uzbek names (the demo signs up in Uzbek)
    roles = {r["name"]: r["id"] for r in await demo.call("GET", "/roles")}
    for login, name, role in STAFF:
        role_id = roles[DEFAULT_ROLES[role]["uz"]]
        r = await demo.c.post(
            f"{API}/staff",
            json={
                "name": name,
                "login": login,
                "password": PASSWORD,
                "role_id": role_id,
            },
        )
        if r.status_code not in (201, 409):
            raise SystemExit(f"adding {login} failed: {r.status_code} {r.text}")
    people = await demo.call("GET", "/staff")
    return {p["username"]: p["id"] for p in people if p["username"]}


async def main() -> None:
    transport = httpx.ASGITransport(app=main_app, client=("127.0.0.1", 1))
    async with httpx.AsyncClient(
        transport=transport, base_url="https://demo"
    ) as client:
        demo = Demo(client)
        r = await client.post(
            f"{API}/auth/signup",
            json={
                "company_name": "Barakali Savdo MChJ",
                "name": "Rustam Karimov",
                "login": LOGIN,
                "password": PASSWORD,
                "lang": "uz",
            },
        )
        if r.status_code == 409:
            await client.post(
                f"{API}/auth/login", json={"login": LOGIN, "password": PASSWORD}
            )
            await add_staff(demo)
            await db_helper.dispose()
            print(
                f"The demo company exists already; its staff are there too. Log in as {LOGIN}."
            )
            return
        if r.status_code != 201:
            raise SystemExit(f"sign-up failed: {r.status_code} {r.text}")
        await seed(demo)
    await db_helper.dispose()
    print(f"Log in as {LOGIN}.")


if __name__ == "__main__":
    asyncio.run(main())
