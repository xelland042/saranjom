import os
import random
import unittest

# Tests marked with this need a migrated Postgres, with MAIN_CONFIG__DB__URL pointing at the
# app role (open_erp_app). CI sets TEST_DATABASE=1; locally scripts/test.sh does.
needs_db = unittest.skipUnless(
    os.environ.get("TEST_DATABASE"), "needs Postgres: set TEST_DATABASE=1"
)


# never the same one twice in a run: a repeat made a sign-up answer 409, and the test that failed
# in its setup left the database connection open for the twenty tests after it
_numbers = iter(random.sample(range(10_000_000), 100_000))


def random_phone() -> str:
    return f"+99890{next(_numbers):07d}"


def random_ip() -> str:
    return "10." + ".".join(str(random.randint(0, 255)) for _ in range(3))
