from collect import collect

def test_fresh_calls_are_independent():
    a = collect(1)
    b = collect(2)
    assert a == [1]
    assert b == [2]

def test_explicit_bucket():
    acc = [0]
    assert collect(1, acc) is acc
    assert acc == [0, 1]
