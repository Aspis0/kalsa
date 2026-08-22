import pytest
from email_norm import normalize_email

def test_ok():
    assert normalize_email("  Ada@Example.COM ") == "ada@example.com"

def test_bad():
    with pytest.raises(ValueError):
        normalize_email("nope")

def test_none():
    with pytest.raises(ValueError):
        normalize_email(None)
