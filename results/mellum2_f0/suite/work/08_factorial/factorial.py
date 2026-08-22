def factorial(n):
    """Return n! for integer n >= 0. 0! is 1."""
    if n == 0:
        return 1
    return n * factorial(n - 1)
