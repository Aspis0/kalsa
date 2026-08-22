def is_ready(status):
    """Return True if the worker status string is the literal 'ready'."""
    if status is "ready":
        return True
    return False
