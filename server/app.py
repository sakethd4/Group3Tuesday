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
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure, PyMongoError
from werkzeug.exceptions import HTTPException

if __package__:
    from . import database, hardwareDatabase, historyDatabase, migration, projectsDatabase, usersDatabase
else:
    import database
    import hardwareDatabase
    import historyDatabase
    import migration
    import projectsDatabase
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


def project_fields(payload):
    if set(payload) - {"projectId", "name", "description"}:
        raise ApiError("Only projectId, name, and description can be supplied.")
    project_id = text_field(payload, "projectId", 64).upper()
    if not HARDWARE_ID_RE.fullmatch(project_id):
        raise ApiError("Project ID must use letters, numbers, hyphens, or underscores.")
    return {"projectId": project_id, "name": text_field(payload, "name", 120),
            "description": text_field({"description": payload.get("description", "")}, "description", 2000, 0)}


def create_app(config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        MONGODB_URI=os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017"),
        MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", "HardwareLibrary"),
        **{f"MONGODB_{kind}_DATABASE": os.environ.get(f"MONGODB_{kind}_DATABASE")
           for kind in ("USERS", "HARDWARE", "PROJECTS", "HISTORY")},
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
    db = database.collections(client, app.config)
    app.extensions["databases"] = db
    index_lock = Lock()
    indexes_ready = False

    def get_db():
        nonlocal indexes_ready
        if not indexes_ready:
            with index_lock:
                if not indexes_ready:
                    database.ensure_indexes(db)
                    indexes_ready = True
        return db

    def body():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ApiError("Request body must be a JSON object.")
        return payload

    def object_id(value, label="Hardware"):
        if not isinstance(value, str) or not ObjectId.is_valid(value):
            raise ApiError(f"{label} not found.", 404)
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
        project_ids = {item.get("checkedOutTo") for item in records} - {None}
        projects = {p["_id"]: p for p in get_db().projects.find({"_id": {"$in": list(project_ids)}})}
        users = {}
        if g.user["role"] == "admin":
            borrower_ids = {item["checkedOutBy"] for item in records if item["checkedOutBy"]}
            if borrower_ids:
                users = {u["_id"]: usersDatabase.public_user(u) for u in get_db().users.find(
                    {"_id": {"$in": list(borrower_ids)}}
                )}
        result = []
        for item in records:
            project = projects.get(item.get("checkedOutTo"))
            member = bool(project and g.user["_id"] in project["memberIds"])
            entry = {
                "id": str(item["_id"]), "hardwareId": item["hardwareId"],
                "name": item["name"], "description": item["description"],
                "status": item["status"],
                "project": projectsDatabase.reference(project) if project else None,
                "isCheckedOutByMyProjects": member,
                "canReturn": member and item["status"] == "checked_out",
                "checkedOutAt": item["checkedOutAt"].isoformat() if item.get("checkedOutAt") else None,
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
        if isinstance(error, OperationFailure) and error.code == 20:
            return jsonify(success=False, message="MongoDB must run as a replica set to save project checkouts and history. See the setup guide."), 503
        return jsonify(success=False, message="Database is unavailable. Please try again shortly."), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(success=False, message=error.description), error.code

    @app.get("/api/health")
    def health():
        get_db()
        client.admin.command("ping")
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

    @app.get("/api/projects")
    @authenticate()
    def project_list():
        query = {"memberIds": g.user["_id"]} if request.args.get("mine") == "true" else {}
        return jsonify(projects=[projectsDatabase.public_project(p, g.user["_id"])
                                 for p in get_db().projects.find(query).sort("projectId", 1)])

    @app.post("/api/projects")
    @authenticate()
    def create_project():
        try:
            project = projectsDatabase.createProject(get_db(), project_fields(body()), g.user["_id"])
        except DuplicateKeyError:
            raise ApiError("A project with this project ID already exists.", 409)
        return jsonify(project=projectsDatabase.public_project(project, g.user["_id"])), 201

    @app.post("/api/projects/<project_id>/join")
    @authenticate()
    def join_project(project_id):
        project = projectsDatabase.joinProject(get_db(), object_id(project_id, "Project"), g.user["_id"])
        if not project:
            raise ApiError("Project not found.", 404)
        return jsonify(project=projectsDatabase.public_project(project, g.user["_id"]))

    @app.delete("/api/projects/<project_id>")
    @authenticate()
    def delete_project(project_id):
        identifier = object_id(project_id, "Project")
        # Checkout increments this same document in its transaction. MongoDB's
        # write conflict handling prevents deleting a project during allocation.
        removed = get_db().projects.delete_one({"_id": identifier, "createdBy": g.user["_id"], "hardwareCount": 0})
        if not removed.deleted_count:
            project = db.projects.find_one({"_id": identifier})
            if not project:
                raise ApiError("Project not found.", 404)
            if project["createdBy"] != g.user["_id"]:
                raise ApiError("Only the creator can delete this project.", 403)
            raise ApiError("Return this project's hardware before deleting it.", 409)
        return "", 204

    @app.get("/api/history")
    @authenticate()
    def history_list():
        query = {}
        if request.args.get("project"):
            query["project.id"] = str(object_id(request.args["project"], "Project"))
        if request.args.get("hardware"):
            query["hardware.id"] = str(object_id(request.args["hardware"]))
        if request.args.get("before"):
            cursor = db.history.find_one({"_id": object_id(request.args["before"], "History cursor")}, {"createdAt": 1})
            if not cursor:
                raise ApiError("History cursor not found.", 404)
            query["$or"] = [
                {"createdAt": {"$lt": cursor["createdAt"]}},
                {"createdAt": cursor["createdAt"], "_id": {"$lt": cursor["_id"]}},
            ]
        records = list(get_db().history.find(query).sort([("createdAt", -1), ("_id", -1)]).limit(51))
        users = {}
        if g.user["role"] == "admin":
            users = {u["_id"]: usersDatabase.public_user(u) for u in db.users.find(
                {"_id": {"$in": [r["actorId"] for r in records]}})}
        events = [{
            "id": str(r["_id"]), "action": r["action"], "hardware": r["hardware"], "project": r["project"],
            "createdAt": r["createdAt"].isoformat(), "isByMe": r["actorId"] == g.user["_id"],
            **({"actor": users.get(r["actorId"])} if g.user["role"] == "admin" else {}),
        } for r in records[:50]]
        return jsonify(history=events, nextCursor=events[-1]["id"] if len(records) > 50 else None)

    @app.get("/api/hardware")
    @authenticate()
    def hardware_list():
        query = {}
        if request.args.get("mine") == "true":
            query["checkedOutTo"] = {"$in": [p["_id"] for p in get_db().projects.find({"memberIds": g.user["_id"]}, {"_id": 1})]}
        if request.args.get("project"):
            query = {"$and": [query, {"checkedOutTo": object_id(request.args["project"], "Project")}]}
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
        payload = body()
        if set(payload) != {"projectId"}:
            raise ApiError("Choose a project to check out hardware; only projectId is accepted.")
        project_id = object_id(payload["projectId"], "Project")

        def allocate(session):
            project = db.projects.find_one_and_update(
                {"_id": project_id, "memberIds": g.user["_id"]}, {"$inc": {"hardwareCount": 1}},
                return_document=ReturnDocument.AFTER, session=session,
            )
            if not project:
                if not db.projects.find_one({"_id": project_id}, session=session):
                    raise ApiError("Project not found.", 404)
                raise ApiError("Join this project before checking out hardware to it.", 403)
            resource = hardwareDatabase.checkOut(db, identifier, project_id, g.user["_id"], session)
            if not resource:
                if not db.hardware.find_one({"_id": identifier}, session=session):
                    raise ApiError("Hardware not found.", 404)
                raise ApiError("This hardware is already checked out. Please choose an available resource.", 409)
            historyDatabase.record(db, "checkout", resource, project, g.user["_id"], session)
            return resource

        resource = database.transaction(client, allocate)
        return jsonify(hardware=serialize_hardware([resource])[0], message="Hardware checked out to project.")

    @app.post("/api/hardware/<resource_id>/return")
    @authenticate()
    def return_hardware(resource_id):
        identifier = object_id(resource_id)

        def release(session):
            current = db.hardware.find_one({"_id": identifier}, session=session)
            if not current:
                raise ApiError("Hardware not found.", 404)
            if current["status"] == "available":
                raise ApiError("This hardware has already been returned.", 409)
            project = db.projects.find_one_and_update(
                {"_id": current["checkedOutTo"], "memberIds": g.user["_id"], "hardwareCount": {"$gt": 0}},
                {"$inc": {"hardwareCount": -1}}, return_document=ReturnDocument.AFTER, session=session,
            )
            if not project:
                raise ApiError("Only members of the assigned project can return this hardware.", 403)
            resource = hardwareDatabase.checkIn(db, identifier, project["_id"], session)
            if not resource:
                raise ApiError("The hardware assignment changed. Refresh and try again.", 409)
            historyDatabase.record(db, "return", current, project, g.user["_id"], session)
            return resource

        resource = database.transaction(client, release)
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

    @app.cli.command("migrate-db")
    @click.option("--source", help="Legacy database name; defaults to MONGODB_DATABASE.")
    def migrate_db(source):
        """Copy legacy users/hardware while the old API is stopped; preserve the source."""
        try:
            users, hardware = migration.migrate(client, get_db(), source or app.config["MONGODB_DATABASE"])
        except (ValueError, PyMongoError) as error:
            raise click.ClickException(f"Migration stopped ({type(error).__name__}). Source data is unchanged. Check database access, unique IDs, and borrower accounts before retrying.")
        click.echo(f"Imported {users} users and {hardware} hardware resources. Source data is unchanged.")

    return app


# Flask and Vercel discover this WSGI application. Tests use create_app with an isolated database.
app = create_app()

if __name__ == "__main__":
    app.run(port=5001)
