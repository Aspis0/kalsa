from percent import percent

def test_half():
    assert percent(1, 2) == 50

def test_third():
    assert abs(percent(1, 3) - (100 / 3)) < 1e-9

def test_over():
    assert percent(3, 2) == 150
