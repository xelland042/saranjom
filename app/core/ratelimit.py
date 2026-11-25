"""How many times one visitor (an IP address) may do something within a period.

shortcut: counted in this process's memory, so a restart forgets and each worker would count
on its own; move the counts to the database when the API runs as more than one process.
"""

import time
from collections import deque


class RateLimit:
    def __init__(self, seconds: int):
        self.seconds = seconds
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int) -> bool:
        """Counts this try and says whether it is still within the limit."""
        now = time.monotonic()
        if len(self._hits) > 10_000:  # forget visitors whose tries have all expired
            self._hits = {
                k: v for k, v in self._hits.items() if v[-1] > now - self.seconds
            }
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - self.seconds:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True
