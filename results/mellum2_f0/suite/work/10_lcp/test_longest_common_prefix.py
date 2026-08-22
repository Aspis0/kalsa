from longest_common_prefix import longest_common_prefix as lcp

def test_basic():
    assert lcp(["flower", "flow", "flight"]) == "fl"

def test_none():
    assert lcp(["dog", "racecar", "car"]) == ""

def test_empty():
    assert lcp([]) == ""

def test_one():
    assert lcp(["alone"]) == "alone"
