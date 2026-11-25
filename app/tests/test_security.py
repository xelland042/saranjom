import threading
import time
import unittest
from unittest.mock import patch

from app.core.security import hash_password, parse_login, verify_password


class ParseLoginTest(unittest.TestCase):
    def test_phone_formats_normalize_to_one(self):
        for raw in [
            "+998 90 123-45-67",
            "998901234567",
            "90 123 45 67",
            "(90) 1234567",
        ]:
            self.assertEqual(parse_login(raw), ("phone", "+998901234567"), raw)

    def test_email_is_lowercased(self):
        self.assertEqual(parse_login(" Ali@Mail.UZ "), ("email", "ali@mail.uz"))

    def test_username_is_lowercased(self):
        self.assertEqual(parse_login("Rustam_92"), ("username", "rustam_92"))

    def test_rejects_bad_input(self):
        for raw in ["12345", "+7 912 345 67 89", "a@b", "ab", "9rustam", "rus tam"]:
            with self.assertRaises(ValueError, msg=raw):
                parse_login(raw)


class PasswordTest(unittest.TestCase):
    def test_hash_verifies_only_the_right_password(self):
        stored = hash_password("correct horse")
        self.assertTrue(verify_password("correct horse", stored))
        self.assertFalse(verify_password("wrong horse", stored))

    def test_same_password_hashes_differently(self):
        self.assertNotEqual(hash_password("x" * 8), hash_password("x" * 8))

    def test_only_two_hashes_run_at_once(self):
        # each real hash takes ~64 MB, so a burst must queue: count how many are inside at once
        lock, running, peak = threading.Lock(), 0, 0

        def slow_scrypt(*args, **kwargs):
            nonlocal running, peak
            with lock:
                running += 1
                peak = max(peak, running)
            time.sleep(0.05)
            with lock:
                running -= 1
            return b"x" * 64

        with patch("app.core.security.hashlib.scrypt", slow_scrypt):
            threads = [
                threading.Thread(target=hash_password, args=("secret-123",))
                for _ in range(6)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(peak, 2)


if __name__ == "__main__":
    unittest.main()
