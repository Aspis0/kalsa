def positives(nums):
    """Return the positive numbers from nums, same order."""
    out = []
    for n in nums:
        if n > 0:
            out.append(n)
    return out
