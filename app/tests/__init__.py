import os

# Settings need a database URL at import time. Without TEST_DATABASE no test connects, so a
# placeholder will do; with it, keep the real URL from the environment or .env.
if not os.environ.get("TEST_DATABASE"):
    os.environ.setdefault(
        "MAIN_CONFIG__DB__URL", "postgresql+asyncpg://u:p@localhost/test"
    )

# Tests never reach the internet: the Central Bank's feed answers with nothing unless a test gives
# it rates (test_rates.py does), so no result depends on cbu.uz being up or on today's real rates.
# CI starts from an empty database, where the first foreign-currency test would otherwise fetch.
from unittest.mock import AsyncMock, patch  # noqa: E402

patch("app.crud.rates.fetch_cbu", AsyncMock(return_value=[])).start()
