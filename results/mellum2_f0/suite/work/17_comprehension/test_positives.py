from positives import positives

def test_mix():
    assert positives([-2, 0, 3, 4, -1]) == [3, 4]

def test_empty():
    assert positives([]) == []
