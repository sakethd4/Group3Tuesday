from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import jwt
import pytest
from bson import ObjectId
from pymongo.errors import ServerSelectionTimeoutError
from werkzeug.security import check_password_hash

import hardwareDatabase
from app import create_app


def test_registration_login_and_hashed_password(client, db, registration):
    response = client.post("/api/register", json={**registration, "email": " ALEX@EXAMPLE.COM "})
    assert response.status_code == 201
    assert response.json["user"]["role"] == "user"
    assert response.json["user"]["email"] == "alex@example.com"
    assert "passwordHash" not in response.json["user"]
    stored = db.users.find_one({"email": "alex@example.com"})
    assert stored["passwordHash"] != registration["password"]
    assert check_password_hash(stored["passwordHash"], registration["password"])
    login = client.post("/api/login", json={"email": "ALEX@example.com", "password": registration["password"]})
    assert login.status_code == 200
    me = client.get("/api/me", headers={"Authorization": f"Bearer {login.json['token']}"})
    assert me.json["user"] == response.json["user"]


def test_duplicate_email_and_invalid_login(client, registration):
    assert client.post("/api/register", json=registration).status_code == 201
    assert client.post("/api/register", json={**registration, "email": "ALEX@EXAMPLE.COM"}).status_code == 409
    for email in (registration["email"], "nobody@example.com"):
        response = client.post("/api/login", json={"email": email, "password": "Incorrect123"})
        assert response.status_code == 401
        assert response.json["message"] == "Email or password is incorrect."


@pytest.mark.parametrize("changes,status", [
    ({"role": "admin"}, 403), ({"role": "Doctor"}, 403),
    ({"email": {"$ne": ""}}, 400), ({"firstName": []}, 400),
    ({"email": "not-an-email"}, 400), ({"password": "weak", "confirmPassword": "weak"}, 400),
    ({"confirmPassword": "Different123"}, 400), ({"password": 123456789}, 400),
])
def test_registration_validation(client, registration, changes, status):
    assert client.post("/api/register", json={**registration, **changes}).status_code == status


@pytest.mark.parametrize("payload", [None, [], "text", 3])
def test_malformed_body_is_rejected(client, payload):
    assert client.post("/api/register", json=payload).status_code == 400


def test_auth_required_and_invalid_tokens(client):
    for token in (None, "not-a-jwt"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        assert client.get("/api/hardware", headers=headers).status_code == 401
        assert client.post("/api/hardware/invalid/checkout", headers=headers).status_code == 401


def test_expired_forged_and_incomplete_jwts(client, app, accounts, db):
    user = db.users.find_one({"email": "alice@example.com"})
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user["_id"]), "iat": now - timedelta(hours=2), "exp": now + timedelta(hours=1),
              "iss": "hardware-library", "aud": "hardware-library"}
    tokens = [
        jwt.encode({**claims, "exp": now - timedelta(seconds=5)}, app.config["JWT_SECRET"], algorithm="HS256"),
        jwt.encode(claims, "another-secret-that-is-at-least-32-bytes", algorithm="HS256"),
        jwt.encode({k: v for k, v in claims.items() if k != "exp"}, app.config["JWT_SECRET"], algorithm="HS256"),
    ]
    for token in tokens:
        assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_checkout_conflict_return_and_reuse(client, accounts, hardware):
    url = f"/api/hardware/{hardware['id']}"
    assert client.get(url, headers=accounts["alice"]).json["hardware"]["status"] == "available"
    first = client.post(f"{url}/checkout", headers=accounts["alice"])
    assert first.status_code == 200
    assert first.json["hardware"]["isCheckedOutByMe"] is True
    assert first.json["hardware"]["status"] == "checked_out"
    for name in ("alice", "bob"):
        assert client.post(f"{url}/checkout", headers=accounts[name]).status_code == 409
    assert client.get("/api/hardware?mine=true", headers=accounts["alice"]).json["hardware"][0]["id"] == hardware["id"]
    assert client.get("/api/hardware?mine=true", headers=accounts["bob"]).json["hardware"] == []
    assert client.post(f"{url}/return", headers=accounts["bob"]).status_code == 403
    assert client.post(f"{url}/return", headers=accounts["admin"]).status_code == 403
    returned = client.post(f"{url}/return", headers=accounts["alice"])
    assert returned.json["hardware"]["status"] == "available"
    assert returned.json["hardware"]["isCheckedOutByMe"] is False
    assert client.post(f"{url}/return", headers=accounts["alice"]).status_code == 409
    assert client.get("/api/hardware?mine=true", headers=accounts["alice"]).json["hardware"] == []
    assert client.post(f"{url}/checkout", headers=accounts["bob"]).status_code == 200


def test_concurrent_checkout_has_exactly_one_winner(app, accounts, hardware, db):
    barrier = Barrier(12)
    def checkout(index):
        with app.test_client() as client:
            barrier.wait()
            return client.post(f"/api/hardware/{hardware['id']}/checkout", headers=accounts["alice" if index % 2 else "bob"]).status_code
    with ThreadPoolExecutor(max_workers=12) as pool:
        statuses = list(pool.map(checkout, range(12)))
    assert statuses.count(200) == 1
    assert statuses.count(409) == 11
    stored = db.hardware.find_one({"_id": ObjectId(hardware["id"])})
    assert stored["status"] == "checked_out" and isinstance(stored["checkedOutBy"], ObjectId)


def test_only_admin_can_manage_hardware(client, accounts, hardware):
    url = f"/api/hardware/{hardware['id']}"
    fields = {"hardwareId": "HW-002", "name": "Hardware 2", "description": "Another resource"}
    assert client.post("/api/hardware", json=fields, headers=accounts["alice"]).status_code == 403
    assert client.put(url, json=fields, headers=accounts["alice"]).status_code == 403
    assert client.delete(url, headers=accounts["alice"]).status_code == 403
    added = client.post("/api/hardware", json=fields, headers=accounts["admin"])
    assert added.status_code == 201
    assert client.post("/api/hardware", json=fields, headers=accounts["admin"]).status_code == 409
    assert client.put(url, json=fields, headers=accounts["admin"]).status_code == 409
    fields["hardwareId"] = "hw-new"
    updated = client.put(url, json=fields, headers=accounts["admin"])
    assert updated.status_code == 200 and updated.json["hardware"]["hardwareId"] == "HW-NEW"
    assert client.delete(url, headers=accounts["admin"]).status_code == 204
    assert client.get(url, headers=accounts["admin"]).status_code == 404


def test_admin_borrower_visibility_and_safe_metadata_edit(client, accounts, hardware):
    url = f"/api/hardware/{hardware['id']}"
    client.post(f"{url}/checkout", headers=accounts["alice"])
    public = client.get("/api/hardware", headers=accounts["bob"]).json["hardware"][0]
    assert "checkedOutBy" not in public
    admin = client.get("/api/hardware", headers=accounts["admin"]).json["hardware"][0]
    assert admin["checkedOutBy"]["email"] == "alice@example.com"
    assert "passwordHash" not in admin["checkedOutBy"]
    fields = {"hardwareId": "HW-001", "name": "Updated name", "description": "Updated description"}
    updated = client.put(url, json=fields, headers=accounts["admin"])
    assert updated.json["hardware"]["status"] == "checked_out"
    assert updated.json["hardware"]["checkedOutBy"] == admin["checkedOutBy"]
    assert client.put(url, json={**fields, "status": "available"}, headers=accounts["admin"]).status_code == 400
    assert client.delete(url, headers=accounts["admin"]).status_code == 409
    client.post(f"{url}/return", headers=accounts["alice"])
    assert client.delete(url, headers=accounts["admin"]).status_code == 204


def test_permissions_are_loaded_from_database(client, accounts, hardware, db):
    db.users.update_one({"email": "admin@example.com"}, {"$set": {"role": "user"}})
    assert client.delete(f"/api/hardware/{hardware['id']}", headers=accounts["admin"]).status_code == 403
    db.users.delete_one({"email": "alice@example.com"})
    assert client.get("/api/me", headers=accounts["alice"]).status_code == 401


@pytest.mark.parametrize("identifier", ["not-an-id", "0" * 24])
def test_missing_hardware(client, accounts, identifier):
    url = f"/api/hardware/{identifier}"
    assert client.get(url, headers=accounts["alice"]).status_code == 404
    assert client.post(f"{url}/checkout", headers=accounts["alice"]).status_code == 404
    assert client.post(f"{url}/return", headers=accounts["alice"]).status_code == 404
    assert client.delete(url, headers=accounts["admin"]).status_code == 404


def test_seed_is_repeatable_and_preserves_checkouts(app, client, accounts, db):
    runner = app.test_cli_runner()
    assert runner.invoke(args=["init-db", "--seed"]).exit_code == 0
    item = db.hardware.find_one({"hardwareId": "HW-001"})
    client.post(f"/api/hardware/{item['_id']}/checkout", headers=accounts["alice"])
    assert runner.invoke(args=["init-db", "--seed"]).exit_code == 0
    assert db.hardware.count_documents({}) == 6
    assert db.hardware.find_one({"_id": item["_id"]})["status"] == "checked_out"


def test_admin_cli(app, client, db):
    runner = app.test_cli_runner()
    args = ["create-admin", "--email", "owner@example.com", "--first-name", "Library", "--last-name", "Owner"]
    result = runner.invoke(args=args, input="OwnerPassword123\nOwnerPassword123\n")
    assert result.exit_code == 0, result.output
    assert db.users.find_one({"email": "owner@example.com"})["role"] == "admin"
    assert client.post("/api/login", json={"email": "owner@example.com", "password": "OwnerPassword123"}).status_code == 200
    assert runner.invoke(args=args, input="OwnerPassword123\nOwnerPassword123\n").exit_code != 0


def test_cors_and_error_responses(client):
    allowed = client.options("/api/hardware/abc", headers={"Origin": "http://localhost:5173"})
    assert allowed.status_code == 204
    assert allowed.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "DELETE" in allowed.headers["Access-Control-Allow-Methods"]
    denied = client.get("/api/health", headers={"Origin": "https://untrusted.example"})
    assert "Access-Control-Allow-Origin" not in denied.headers
    assert client.get("/api/missing").is_json
    assert client.get("/api/health").headers["Cache-Control"] == "no-store"


def test_database_failure_returns_503(client, accounts, hardware, monkeypatch):
    def unavailable(*args):
        raise ServerSelectionTimeoutError("internal connection details")
    monkeypatch.setattr(hardwareDatabase, "checkOut", unavailable)
    response = client.post(f"/api/hardware/{hardware['id']}/checkout", headers=accounts["alice"])
    assert response.status_code == 503
    assert "internal connection details" not in response.json["message"]


def test_missing_secret_fails_closed():
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        create_app({"JWT_SECRET": ""})


@pytest.mark.parametrize("fields", [
    {"hardwareId": "HW invalid", "name": "Hardware", "description": "A resource"},
    {"hardwareId": "HW-001", "name": " ", "description": "A resource"},
    {"hardwareId": "HW-001", "name": "Hardware", "description": {"$ne": ""}},
    {"hardwareId": "HW-001", "name": "Hardware", "description": "A resource", "checkedOutBy": "someone"},
])
def test_invalid_hardware_fields(client, accounts, fields):
    assert client.post("/api/hardware", json=fields, headers=accounts["admin"]).status_code == 400


def test_checkout_racing_removal_never_loses_an_assignment(app, accounts, hardware, db):
    barrier = Barrier(2)
    url = f"/api/hardware/{hardware['id']}"
    def checkout():
        with app.test_client() as client:
            barrier.wait()
            return client.post(f"{url}/checkout", headers=accounts["alice"]).status_code
    def remove():
        with app.test_client() as client:
            barrier.wait()
            return client.delete(url, headers=accounts["admin"]).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        checkout_request = pool.submit(checkout)
        removal_request = pool.submit(remove)
        statuses = checkout_request.result(), removal_request.result()
    stored = db.hardware.find_one({"_id": ObjectId(hardware["id"])})
    if statuses == (200, 409):
        assert stored["status"] == "checked_out" and stored["checkedOutBy"] is not None
    else:
        assert statuses == (404, 204)
        assert stored is None
