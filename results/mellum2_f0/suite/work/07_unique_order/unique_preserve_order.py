def unique_preserve_order(items):
    """Return unique items, keeping the first occurrence of each value."""
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
