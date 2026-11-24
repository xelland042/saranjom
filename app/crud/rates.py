import logging
import time
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import InvalidField
from app.core.cbu import fetch_cbu
from app.models import CbuRate, CompanyRate, PriceList, Tenant

log = logging.getLogger(__name__)
# don't ask the Central Bank again sooner than this after a failed or useless try
RETRY_SECONDS = 3600
# shortcut: remembered per process, so each worker may try once an hour; move to a scheduled
# job when the app gets a worker (the outbox step).
# None until the first try: monotonic time starts near zero at boot, so 0.0 would read as a
# try moments ago and skip fetching for the first hour after a server starts
_last_try: float | None = None
_clock = (
    time.monotonic
)  # a seam for tests (patching time.monotonic itself breaks asyncio)


class RatesManager:
    """Exchange rates for showing prices in the company's main currency ("≈ 120 000 soʻm").
    Hints only: prices are never converted or overwritten. The company's own rate wins over the
    Central Bank's; the Central Bank's are fetched at most once a day, on demand."""

    def __init__(self, session: AsyncSession, tenant: Tenant):
        self.session = session
        self.tenant = tenant

    async def current(self, also: tuple[str, ...] = ()) -> list[dict]:
        """A rate for each currency used by the company's active price lists (and `also`), other
        than its own."""
        currencies = sorted(
            set(
                await self.session.scalars(
                    select(PriceList.currency).where(PriceList.archived_at.is_(None))
                )
            )
            .union(also)
            .difference({self.tenant.currency})
        )
        if not currencies:
            return []
        await self._refresh_cbu(currencies + [self.tenant.currency])
        own = {
            r.currency: r
            for r in await self.session.scalars(
                select(CompanyRate).where(CompanyRate.currency.in_(currencies))
            )
        }
        official = await self._latest_cbu(currencies + [self.tenant.currency])
        out = []
        for c in currencies:
            cbu = self._in_base(official, c)
            mine = own.get(c)
            out.append(
                {
                    "currency": c,
                    "rate": mine.rate if mine else (cbu[0] if cbu else None),
                    "source": "company" if mine else ("cbu" if cbu else None),
                    "cbu_rate": cbu[0] if cbu else None,
                    "cbu_date": cbu[1] if cbu else None,
                }
            )
        return out

    async def rate_of(self, currency: str) -> Decimal:
        """The rate to save on a document in this currency; 422 rather than a guess when none."""
        rates = await self.current((currency,))
        rate = next((r["rate"] for r in rates if r["currency"] == currency), None)
        if rate is None:
            raise InvalidField("exchange_rate", "No exchange rate for this currency")
        return rate

    async def set_own(self, currency: str, rate: Decimal) -> None:
        stmt = insert(CompanyRate).values(
            tenant_id=self.tenant.id, currency=currency, rate=rate
        )
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=["tenant_id", "currency"],
                set_={"rate": rate, "updated_at": func.now()},
            )
        )

    async def remove_own(self, currency: str) -> None:
        await self.session.execute(
            delete(CompanyRate).where(CompanyRate.currency == currency)
        )

    def _in_base(self, official: dict, currency: str):
        """The official rate as units of the company's main currency per one unit, with its date.
        The Central Bank quotes everything in soʻm, so other main currencies go through soʻm.
        """
        if currency not in official:
            return None
        rate, day = official[currency]
        if self.tenant.currency != "UZS":
            if self.tenant.currency not in official:
                return None
            base_rate, base_day = official[self.tenant.currency]
            rate, day = rate / base_rate, min(day, base_day)
        return rate.quantize(Decimal("0.000001")), day

    async def _latest_cbu(
        self, currencies: list[str]
    ) -> dict[str, tuple[Decimal, date]]:
        newest = (
            select(CbuRate.currency, func.max(CbuRate.date).label("d"))
            .where(CbuRate.currency.in_(currencies))
            .group_by(CbuRate.currency)
            .subquery()
        )
        rows = await self.session.execute(
            select(CbuRate.currency, CbuRate.rate, CbuRate.date).join(
                newest,
                (newest.c.currency == CbuRate.currency) & (newest.c.d == CbuRate.date),
            )
        )
        official = {c: (r, d) for c, r, d in rows.all()}
        official["UZS"] = (Decimal(1), date.max)
        return official

    async def _refresh_cbu(self, currencies: list[str]) -> None:
        """Fetch today's official rates if we don't have them. Offline or failing, the last saved
        rates (or the company's own) still work, and we try again after RETRY_SECONDS.
        """
        global _last_try
        today = clock.today()
        # fetch unless every currency needed already has today's rate (soʻm needs none); a stray
        # currency dated today must not stand in for the others
        needed = set(currencies) - {"UZS"}
        fresh = await self.session.scalar(
            select(func.count(func.distinct(CbuRate.currency))).where(
                CbuRate.currency.in_(needed), CbuRate.date >= today
            )
        )
        if fresh == len(needed):
            return
        if _last_try is not None and _clock() - _last_try < RETRY_SECONDS:
            return
        _last_try = _clock()
        try:
            rows = await fetch_cbu()
        except Exception as e:  # network, HTTP or JSON: the hint just stays older
            log.warning("Central Bank rates not fetched: %s", e)
            return
        if not rows:
            return
        stmt = insert(CbuRate).values(
            [{"currency": c, "rate": r, "date": d} for c, r, d in rows]
        )
        # two requests may fetch at once; the second one's rows are already there.
        # (Early in the day the bank's list may still be yesterday's: we ask again in an hour.)
        await self.session.execute(
            stmt.on_conflict_do_nothing(index_elements=["currency", "date"])
        )
