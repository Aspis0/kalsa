def longest_common_prefix(strs):
    """Return the longest common prefix of the given strings.
    Empty input -> ''. A single string -> that string.
    """
    if not strs:
        return ''
    if len(strs) == 1:
        return strs[0]

    prefix = strs[0]
    for s in strs[1:]:
        while not s.startswith(prefix):
            prefix = prefix[:-1]
            if not prefix:
                return ''

    return prefix
