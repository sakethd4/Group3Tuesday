"""Flask API for the HaaS hardware library."""
import os
import re
from datetime import datetime, timedelta, timezone
from functools import wraps
from threading import Lock

import click
import jwt
from bson import ObjectId
from flask import Flask, g, jsonify, request
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.exceptions import HTTPException

if __package__:
    from . import hardwareDatabase, usersDatabase
else:
    import hardwareDatabase
    import usersDatabase

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
HARDWARE_ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{0,63}$")


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message = message
        self.status = status


def text_field(payload, name, maximum, minimum=1):
    value = payload.get(name)
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise ApiError(f"{name} must contain {minimum} to {maximum} characters.")
    return value.strip()


def validate_password(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise ApiError("Password must contain 8 to 128 characters.")
    if not all(re.search(pattern, password) for pattern in (r"[A-Z]", r"[a-z]", r"\d")):
        raise ApiError("Password must include uppercase, lowercase, and a number.")
    return password


def registration_fields(payload):
    if payload.get("role", "user") != "user":
        raise ApiError("Administrator accounts must be created by the system operator.", 403)
    first_name = text_field(payload, "firstName", 80)
    last_name = text_field(payload, "lastName", 80)
    email = text_field(payload, "email", 254).lower()
    if not EMAIL_RE.fullmatch(email):
        raise ApiError("Please enter a valid email address.")
    password = validate_password(payload.get("password"))
    if password != payload.get("confirmPassword"):
        raise ApiError("Password and confirm password must match.")
    return first_name, last_name, email, password


def hardware_fields(payload):
    if set(payload) - {"hardwareId", "name", "description"}:
        raise ApiError("Only hardwareId, name, and description can be edited.")
    hardware_id = text_field(payload, "hardwareId", 64).upper()
    if not HARDWARE_ID_RE.fullmatch(hardware_id):
        raise ApiError("Hardware ID must use letters, numbers, hyphens, or underscores.")
    return {
        "hardwareId": hardware_id,
        "name": text_field(payload, "name", 120),
        "description": text_field(payload, "description", 2000),
    }


def create_app(config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        MONGODB_URI=os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"),
        MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", "HardwareLibrary"),
        JWT_SECRET=os.environ.get("JWT_SECRET", ""),
        JWT_EXPIRATION_SECONDS=3600,
        CLIENT_ORIGIN=os.environ.get("CLIENT_ORIGIN", "http://localhost:5173"),
        MAX_CONTENT_LENGTH=16 * 1024,
    )
    if config:
        app.config.update(config)
    if len(app.config["JWT_SECRET"].encode()) < 32:
        raise RuntimeError("Set JWT_SECRET to a random secret of at least 32 bytes before starting Flask.")

    client = MongoClient(app.config["MONGODB_URI"], serverSelectionTimeoutMS=5000, tz_aware=True)
    app.extensions["mongo_client"] = client
    db = client[app.config["MONGODB_DATABASE"]]
    index_lock = Lock()
    indexes_ready = False

    def get_db():
        nonlocal indexes_ready
        if not indexes_ready:
            with index_lock:
                if not indexes_ready:
                    db.users.create_index("email", unique=True)
                    db.hardware.create_index("hardwareId", unique=True)
                    db.hardware.create_index("checkedOutBy")
                    indexes_ready = True
        return db

    def body():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ApiError("Request body must be a JSON object.")
        return payload

    def object_id(value):
        if not ObjectId.is_valid(value):
            raise ApiError("Hardware not found.", 404)
        return ObjectId(value)

    def authenticate(admin=False):
        def decorator(view):
            @wraps(view)
            def wrapped(*args, **kwargs):
                authorization = request.headers.get("Authorization", "").split()
                if len(authorization) != 2 or authorization[0].lower() != "bearer":
                    raise ApiError("Please sign in to continue.", 401)
                try:
                    claims = jwt.decode(
                        authorization[1], app.config["JWT_SECRET"], algorithms=["HS256"],
                        issuer="hardware-library", audience="hardware-library",
                        options={"require": ["sub", "iat", "exp", "iss", "aud"]},
                    )
                    if not ObjectId.is_valid(claims["sub"]):
                        raise ValueError("Invalid subject")
                except (jwt.InvalidTokenError, ValueError, TypeError):
                    raise ApiError("Your session has expired or is invalid. Please sign in again.", 401)
                g.user = get_db().users.find_one({"_id": ObjectId(claims["sub"])})
                if not g.user or g.user.get("role") not in {"user", "admin"}:
                    raise ApiError("Your account is unavailable. Please sign in again.", 401)
                if admin and g.user["role"] != "admin":
                    raise ApiError("Administrator permission is required.", 403)
                return view(*args, **kwargs)
            return wrapped
        return decorator

    def session_response(user, status=200):
        now = datetime.now(timezone.utc)
        token = jwt.encode({
            "sub": str(user["_id"]), "iat": now,
            "exp": now + timedelta(seconds=app.config["JWT_EXPIRATION_SECONDS"]),
            "iss": "hardware-library", "aud": "hardware-library",
        }, app.config["JWT_SECRET"], algorithm="HS256")
        return jsonify(success=True, token=token, user=usersDatabase.public_user(user)), status

    def serialize_hardware(records):
        users = {}
        if g.user["role"] == "admin":
            borrower_ids = {item["checkedOutBy"] for item in records if item["checkedOutBy"]}
            if borrower_ids:
                users = {u["_id"]: usersDatabase.public_user(u) for u in get_db().users.find(
                    {"_id": {"$in": list(borrower_ids)}}
                )}
        result = []
        for item in records:
            entry = {
                "id": str(item["_id"]), "hardwareId": item["hardwareId"],
                "name": item["name"], "description": item["description"],
                "status": item["status"],
                "isCheckedOutByMe": item["checkedOutBy"] == g.user["_id"],
            }
            if g.user["role"] == "admin":
                entry["checkedOutBy"] = users.get(item["checkedOutBy"])
            result.append(entry)
        return result

    @app.before_request
    def preflight():
        if request.method == "OPTIONS":
            return "", 204

    @app.after_request
    def headers(response):
        origins = {origin.strip().rstrip("/") for origin in app.config["CLIENT_ORIGIN"].split(",")}
        origin = request.headers.get("Origin")
        if origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.vary.add("Origin")
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.errorhandler(ApiError)
    def api_error(error):
        return jsonify(success=False, message=error.message), error.status

    @app.errorhandler(DuplicateKeyError)
    def duplicate_hardware(_error):
        return jsonify(success=False, message="A resource with this hardware ID already exists."), 409

    @app.errorhandler(PyMongoError)
    def database_error(error):
        app.logger.error("Database request failed (%s).", type(error).__name__)
        return jsonify(success=False, message="Database is unavailable. Please try again shortly."), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(success=False, message=error.description), error.code

    @app.get("/api/health")
    def health():
        get_db().command("ping")
        return jsonify(status="ok")

    @app.post("/api/register")
    def register():
        fields = registration_fields(body())
        try:
            user = usersDatabase.addUser(get_db(), *fields)
        except usersDatabase.DuplicateEmailError:
            raise ApiError("An account with this email already exists.", 409)
        return session_response(user, 201)

    @app.post("/api/login")
    def login():
        payload = body()
        email = text_field(payload, "email", 254)
        password = payload.get("password")
        if not isinstance(password, str) or not 1 <= len(password) <= 128:
            raise ApiError("Email or password is incorrect.", 401)
        user = usersDatabase.login(get_db(), email, password)
        if not user or user.get("role") not in {"user", "admin"}:
            raise ApiError("Email or password is incorrect.", 401)
        return session_response(user)

    @app.get("/api/me")
    @authenticate()
    def me():
        return jsonify(user=usersDatabase.public_user(g.user))

    @app.get("/api/hardware")
    @authenticate()
    def hardware_list():
        query = {"checkedOutBy": g.user["_id"]} if request.args.get("mine") == "true" else {}
        records = list(get_db().hardware.find(query).sort("hardwareId", 1))
        return jsonify(hardware=serialize_hardware(records))

    @app.get("/api/hardware/<resource_id>")
    @authenticate()
    def hardware_detail(resource_id):
        resource = get_db().hardware.find_one({"_id": object_id(resource_id)})
        if not resource:
            raise ApiError("Hardware not found.", 404)
        return jsonify(hardware=serialize_hardware([resource])[0])

    @app.post("/api/hardware/<resource_id>/checkout")
    @authenticate()
    def checkout(resource_id):
        identifier = object_id(resource_id)
        resource = hardwareDatabase.checkOut(get_db(), identifier, g.user["_id"])
        if not resource:
            if not get_db().hardware.find_one({"_id": identifier}, {"_id": 1}):
                raise ApiError("Hardware not found.", 404)
            raise ApiError("This hardware is already checked out. Please choose an available resource.", 409)
        return jsonify(hardware=serialize_hardware([resource])[0], message="Hardware checked out.")

    @app.post("/api/hardware/<resource_id>/return")
    @authenticate()
    def return_hardware(resource_id):
        identifier = object_id(resource_id)
        resource = hardwareDatabase.checkIn(get_db(), identifier, g.user["_id"])
        if not resource:
            current = get_db().hardware.find_one({"_id": identifier})
            if not current:
                raise ApiError("Hardware not found.", 404)
            if current["status"] == "available":
                raise ApiError("This hardware has already been returned.", 409)
            raise ApiError("You can only return hardware checked out by you.", 403)
        return jsonify(hardware=serialize_hardware([resource])[0], message="Hardware returned.")

    @app.post("/api/hardware")
    @authenticate(admin=True)
    def add_hardware():
        resource = hardwareDatabase.createHardware(get_db(), hardware_fields(body()))
        return jsonify(hardware=serialize_hardware([resource])[0], message="Hardware added."), 201

    @app.put("/api/hardware/<resource_id>")
    @authenticate(admin=True)
    def update_hardware(resource_id):
        resource = hardwareDatabase.updateHardware(get_db(), object_id(resource_id), hardware_fields(body()))
        if not resource:
            raise ApiError("Hardware not found.", 404)
        return jsonify(hardware=serialize_hardware([resource])[0], message="Hardware updated.")

    @app.delete("/api/hardware/<resource_id>")
    @authenticate(admin=True)
    def delete_hardware(resource_id):
        identifier = object_id(resource_id)
        if not hardwareDatabase.removeHardware(get_db(), identifier):
            if not get_db().hardware.find_one({"_id": identifier}, {"_id": 1}):
                raise ApiError("Hardware not found.", 404)
            raise ApiError("Checked-out hardware must be returned before it can be removed.", 409)
        return "", 204

    @app.cli.command("init-db")
    @click.option("--seed", is_flag=True, help="Add Hardware 1 through Hardware 6 if absent.")
    def init_db(seed):
        get_db()
        if seed:
            hardwareDatabase.seedHardware(db)
        click.echo("Database indexes ready." + (" Six sample resources ensured." if seed else ""))

    @app.cli.command("create-admin")
    @click.option("--email", prompt=True)
    @click.option("--first-name", prompt=True)
    @click.option("--last-name", prompt=True)
    @click.password_option()
    def create_admin(email, first_name, last_name, password):
        try:
            fields = registration_fields({
                "email": email, "firstName": first_name, "lastName": last_name,
                "password": password, "confirmPassword": password,
            })
            usersDatabase.addUser(get_db(), *fields, role="admin")
        except ApiError as error:
            raise click.ClickException(error.message)
        except usersDatabase.DuplicateEmailError:
            raise click.ClickException("An account with this email already exists; no permissions changed.")
        click.echo("Administrator account created.")

    return app


# Flask and Vercel discover this WSGI application. Tests use create_app with an isolated database.
app = create_app()

if __name__ == "__main__":
    app.run(port=5001)
