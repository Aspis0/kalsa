import pytest
from get_last import get_last

def test_list():
    assert get_last([10, 20, 30]) == 30

def test_str():
    assert get_last("abc") == "c"

def test_one():
    assert get_last([7]) == 7
