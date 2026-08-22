from is_valid_parens import is_valid_parens

def test_ok():
    assert is_valid_parens("()[]{}") is True
    assert is_valid_parens("{[]}") is True
    assert is_valid_parens("") is True

def test_bad():
    assert is_valid_parens("(]") is False
    assert is_valid_parens("([)]") is False
    assert is_valid_parens("(") is False
