from access import access_level

def test_admin():
    assert access_level({"role": "admin", "active": True}) == "admin"

def test_inactive_admin():
    assert access_level({"role": "admin", "active": False}) == "guest"

def test_user():
    assert access_level({"role": "member"}) == "user"

def test_guest():
    assert access_level(None) == "guest"
    assert access_level({}) == "guest"
