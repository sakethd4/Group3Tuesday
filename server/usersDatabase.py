from datetime import datetime, timezone

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash


class DuplicateEmailError(Exception):
    pass


def _users_collection(client, database_name):
    collection = client[database_name]["users"]
    collection.create_index([("email", ASCENDING)], unique=True)
    return collection


def addUser(client, database_name, first_name, last_name, email, password, role):
    users = _users_collection(client, database_name)
    normalized_email = email.strip().lower()

    if users.find_one({"email": normalized_email}, {"_id": 1}):
        raise DuplicateEmailError()

    now = datetime.now(timezone.utc)
    user_document = {
        "firstName": first_name.strip(),
        "lastName": last_name.strip(),
        "email": normalized_email,
        "passwordHash": generate_password_hash(password),
        "role": role,
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        result = users.insert_one(user_document)
    except DuplicateKeyError as exc:
        raise DuplicateEmailError() from exc

    return {
        "id": str(result.inserted_id),
        "firstName": user_document["firstName"],
        "lastName": user_document["lastName"],
        "email": user_document["email"],
        "role": user_document["role"],
    }
