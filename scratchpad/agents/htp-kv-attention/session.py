"""Timestamped event lines to stdout and the run's session-events.log."""

import datetime


class Session:
    def __init__(self, events_path):
        self.events_path = events_path

    def event(self, message):
        line = (f"{datetime.datetime.now(datetime.timezone.utc).isoformat()}"
                f"\t{message}")
        with self.events_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        print(line, flush=True)
