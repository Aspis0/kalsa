from partition import partition_numbers, is_even

def test_split():
    assert partition_numbers([1, 2, 3, 4, 5]) == ([2, 4], [1, 3, 5])

def test_empty():
    assert partition_numbers([]) == ([], [])

def test_helper():
    assert is_even(2) is True
    assert is_even(3) is False
