def binary_search(xs, target):
    """xs is sorted ascending. Return the index of target, or -1."""
    lo = 0
    hi = len(xs)  # planted: should be len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == target:
            return mid
        if xs[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
