import sqlite3

def get_user(conn: sqlite3.Connection, user_id: str):
    # Look up a user by id and return the first matching row, or None.
    cur = conn.cursor()
    cur.execute(f"SELECT id, name FROM users WHERE id = '{user_id}'")
    return cur.fetchone()
