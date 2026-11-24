"""The Central Bank of Uzbekistan's daily exchange rates (cbu.uz): a free public JSON feed."""

from datetime import date, datetime
from decimal import Decimal

import httpx

CBU_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/"


def parse_cbu(rows: list[dict]) -> list[tuple[str, Decimal, date]]:
    """[{"Ccy": "USD", "Nominal": "1", "Rate": "12010.45", "Date": "18.11.2026"}, ...] as
    (currency, soʻm per ONE unit, date). Some currencies are quoted per 10 units (Nominal).
    """
    out = []
    for r in rows:
        try:
            nominal = Decimal(r["Nominal"])
            rate = Decimal(r["Rate"]) / nominal
            day = datetime.strptime(r["Date"], "%d.%m.%Y").date()
            currency = str(r["Ccy"]).upper()
        except (KeyError, ArithmeticError, ValueError, TypeError):
            continue  # one odd row shouldn't lose the rest
        if len(currency) == 3 and rate > 0:
            out.append((currency, rate.quantize(Decimal("0.000001")), day))
    return out


async def fetch_cbu() -> list[tuple[str, Decimal, date]]:
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(CBU_URL)
        r.raise_for_status()
        return parse_cbu(r.json())
