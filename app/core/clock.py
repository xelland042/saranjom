"""Uzbekistan's time. The business day is Tashkent's (UTC+5, no daylight saving) whatever clock the
server runs on: a server on UTC would otherwise date things 5 hours late, after midnight in
Tashkent."""

from datetime import date, datetime, timedelta, timezone

TASHKENT = timezone(timedelta(hours=5))


def now() -> datetime:
    return datetime.now(TASHKENT)


def today() -> date:
    return now().date()
