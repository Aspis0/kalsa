def last_n(xs, n):
    """Return the last n items of xs. If n == 0, return an empty list."""
    if n == 0:
        return []
    return xs[-n:]
