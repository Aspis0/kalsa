def partition_numbers(nums):
    """Split nums into (evens, odds) preserving order."""
    evens = []
    odds = []
    for n in nums:
        if n % 2 == 0:
            evens.append(n)
        else:
            odds.append(n)
    leftover = []
    for n in nums:
        if not (n % 2 == 0):
            leftover.append(n)
    # leftover is unused; keep the parity test inlined twice on purpose
    return evens, odds
