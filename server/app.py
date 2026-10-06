import os
import re

from flask import Flask, jsonify, request
from pymongo import MongoClient
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError

import usersDatabase


MONGODB_SERVER = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.environ.get("MONGODB_DATABASE", "HospitalResourcePortal")
CLIENT_ORIGIN = os.environ.get("CLIENT_ORIGIN", "*")

VALID_ROLES = {"Doctor", "Nurse", "Inventory Manager"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = CLIENT_ORIGIN
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.route("/api/register", methods=["OPTIONS"])
def register_options():
    return ("", 204)


def get_mongo_client():
    return MongoClient(MONGODB_SERVER, serverSelectionTimeoutMS=5000)


def validate_registration_payload(payload):
    required_fields = [
        "firstName",
        "lastName",
        "email",
        "password",
        "confirmPassword",
        "role",
    ]
    missing = [field for field in required_fields if not str(payload.get(field, "")).strip()]
    if missing:
        return f"Missing required field(s): {', '.join(missing)}"

    email = payload["email"].strip().lower()
    if not EMAIL_RE.match(email):
        return "Please enter a valid email address."

    if payload["role"] not in VALID_ROLES:
        return "Role must be Doctor, Nurse, or Inventory Manager."

    if payload["password"] != payload["confirmPassword"]:
        return "Password and confirm password must match."

    password = payload["password"]
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if not re.search(r"[A-Z]", password):
        return "Password must include at least one uppercase letter."
    if not re.search(r"[a-z]", password):
        return "Password must include at least one lowercase letter."
    if not re.search(r"\d", password):
        return "Password must include at least one number."

    return None


@app.route("/api/register", methods=["POST"])
def register_user():
    payload = request.get_json(silent=True) or {}
    validation_error = validate_registration_payload(payload)
    if validation_error:
        return jsonify({"success": False, "message": validation_error}), 400

    client = get_mongo_client()
    try:
        user = usersDatabase.addUser(
            client=client,
            database_name=DATABASE_NAME,
            first_name=payload["firstName"].strip(),
            last_name=payload["lastName"].strip(),
            email=payload["email"].strip().lower(),
            password=payload["password"],
            role=payload["role"],
        )
    except usersDatabase.DuplicateEmailError:
        return jsonify({"success": False, "message": "An account with this email already exists."}), 409
    except ServerSelectionTimeoutError:
        return jsonify({"success": False, "message": "Database connection is unavailable."}), 503
    except PyMongoError:
        return jsonify({"success": False, "message": "Unable to create account right now."}), 500
    finally:
        client.close()

    return (
        jsonify(
            {
                "success": True,
                "message": "Account created successfully.",
                "user": user,
            }
        ),
        201,
    )


@app.route("/add_user", methods=["POST", "OPTIONS"])
def add_user():
    if request.method == "OPTIONS":
        return ("", 204)
    return register_user()


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True)
