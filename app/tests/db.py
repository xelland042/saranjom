import os
import random
import unittest

# Tests marked with this need a migrated Postgres, with MAIN_CONFIG__DB__URL pointing at the
# app role (open_erp_app). CI sets TEST_DATABASE=1; locally scripts/test.sh does.
needs_db = unittest.skipUnless(
    os.environ.get("TEST_DATABASE"), "needs Postgres: set TEST_DATABASE=1"
)


def random_phone() -> str:
    return "+99890" + "".join(random.choices("0123456789", k=7))


def random_ip() -> str:
    return "10." + ".".join(str(random.randint(0, 255)) for _ in range(3))
