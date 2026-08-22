from clamp import clamp

def test_inside():
    assert clamp(5, 0, 10) == 5

def test_below():
    assert clamp(-3, 0, 10) == 0

def test_above():
    assert clamp(99, 0, 10) == 10

def test_edges():
    assert clamp(0, 0, 10) == 0
    assert clamp(10, 0, 10) == 10
