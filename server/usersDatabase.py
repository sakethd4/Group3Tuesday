"""User persistence for the hardware library."""
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError
from werkzeug.security import check_password_hash, generate_password_hash


class DuplicateEmailError(Exception):
    pass


def public_user(user):
    return {
        "id": str(user["_id"]),
        "firstName": user["firstName"],
        "lastName": user["lastName"],
        "email": user["email"],
        "role": user["role"],
    }


def addUser(db, first_name, last_name, email, password, role="user"):
    now = datetime.now(timezone.utc)
    user = {
        "firstName": first_name.strip(),
        "lastName": last_name.strip(),
        "email": email.strip().lower(),
        "passwordHash": generate_password_hash(password),
        "role": role,
        "createdAt": now,
    }
    try:
        db.users.insert_one(user)
    except DuplicateKeyError as exc:
        raise DuplicateEmailError() from exc
    return user


def login(db, email, password):
    user = db.users.find_one({"email": email.strip().lower()})
    if user and check_password_hash(user["passwordHash"], password):
        return user
    return None
