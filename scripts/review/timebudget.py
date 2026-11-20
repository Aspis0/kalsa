"""Wall-clock budgets: one for the whole run, one per fork."""

from __future__ import annotations

import os
import time

DEFAULT_RUN_MINUTES = 150
FORK_MINUTES = 60


class Deadline:
    """A monotonic expiry; the clock is injectable so tests can drive time."""

    def __init__(self, seconds: float, clock=time.monotonic):
        self._clock = clock
        self._end = clock() + seconds

    def expired(self) -> bool:
        return self._clock() >= self._end

    def remaining(self) -> float:
        return max(0.0, self._end - self._clock())


def run_deadline() -> Deadline:
    """REVIEW_TIME_BUDGET_MIN stays below the 180-minute job cap."""
    minutes = float(os.environ.get("REVIEW_TIME_BUDGET_MIN", DEFAULT_RUN_MINUTES))
    return Deadline(minutes * 60)


def fork_deadline(run: Deadline) -> Deadline:
    return Deadline(min(FORK_MINUTES * 60, run.remaining()))
