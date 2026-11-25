import hashlib
import hmac
import re
import secrets
import threading
from typing import Literal

LoginKind = Literal["phone", "email", "username"]

_USERNAME = re.compile(r"[a-z][a-z0-9._-]{2,31}")
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def normalize_phone(raw: str) -> str:
    """An Uzbek phone typed any common way ("90 123-45-67", "+998 (90) ...") as +998XXXXXXXXX."""
    digits = re.sub(r"[\s()+-]", "", raw)
    if digits.isdigit() and len(digits) == 9:
        digits = "998" + digits
    if not (digits.isdigit() and len(digits) == 12 and digits.startswith("998")):
        raise ValueError("Phone must be an Uzbek number: +998 and 9 digits")
    return "+" + digits


def parse_login(raw: str) -> tuple[LoginKind, str]:
    """Tell a phone, email or username apart by its format and normalize it.

    Phones become +998XXXXXXXXX whatever way they're typed. A username must start with a
    letter, so it can never look like a phone or an email. Raises ValueError otherwise.
    """
    value = raw.strip()
    if "@" in value:
        if not _EMAIL.fullmatch(value):
            raise ValueError("Invalid email")
        return "email", value.lower()
    if re.sub(r"[\s()+-]", "", value).isdigit():
        return "phone", normalize_phone(value)
    username = value.lower()
    if not _USERNAME.fullmatch(username):
        raise ValueError(
            "Username: 3-32 letters, digits, dot, dash or underscore, starting with a letter"
        )
    return "username", username


# scrypt is in the standard library and memory-hard; ~64 MB and ~0.1 s per hash
_N, _R, _P = 2**16, 8, 1
_MAXMEM = 128 * 1024 * 1024
# two hashes at a time, the rest wait: six logins at once took 430 MB on a 1 GB server, and
# nobody needs an account to send them
_slots = threading.BoundedSemaphore(2)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    with _slots:
        digest = hashlib.scrypt(
            password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=_MAXMEM
        )
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    _, n, r, p, salt, digest = stored.split("$")
    with _slots:
        candidate = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=_MAXMEM,
        )
    return hmac.compare_digest(candidate, bytes.fromhex(digest))


# verified when the login doesn't exist, so a wrong login takes as long as a wrong password
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
