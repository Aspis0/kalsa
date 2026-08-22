def clamp(x, lo, hi):
    """Return x limited to the closed interval [lo, hi]. Assume lo <= hi."""
    return min(lo, max(x, hi))
