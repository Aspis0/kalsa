from inclusive_sum import inclusive_sum

def test_span():
    assert inclusive_sum(1, 4) == 10

def test_single():
    assert inclusive_sum(5, 5) == 5

def test_zero():
    assert inclusive_sum(0, 0) == 0
