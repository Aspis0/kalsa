def access_level(user):
    """Return 'admin', 'user', or 'guest'."""
    if user is not None:
        if "role" in user:
            if user["role"] == "admin":
                if user.get("active", True):
                    return "admin"
                else:
                    return "guest"
            else:
                if user.get("active", True):
                    return "user"
                else:
                    return "guest"
        else:
            return "guest"
    else:
        return "guest"
