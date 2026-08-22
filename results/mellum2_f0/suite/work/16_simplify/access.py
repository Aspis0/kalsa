def access_level(user):
    """Return 'admin', 'user', or 'guest'."""
    if user is None:
        return "guest"

    if "role" not in user:
        return "guest"

    if user["role"] == "admin":
        if user.get("active", True):
            return "admin"
        else:
            return "guest"

    if user.get("active", True):
        return "user"

    return "guest"
