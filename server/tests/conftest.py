"""Integration tests use a real MongoDB and delete only their own unique database."""
import os
from uuid import uuid4

import pytest
from pymongo.errors import PyMongoError

os.environ.setdefault("JWT_SECRET", "test-process-only-secret-never-use-in-production")
from app import create_app


@pytest.fixture
def app():
    instance = create_app({
        "TESTING": True,
        "MONGODB_URI": os.environ.get("TEST_MONGODB_URI", "mongodb://127.0.0.1:27017"),
        "MONGODB_DATABASE": f"haas_test_{uuid4().hex}",
        "JWT_SECRET": "isolated-test-signing-secret-at-least-32-bytes",
    })
    mongo = instance.extensions["mongo_client"]
    try:
        mongo.admin.command("ping")
    except PyMongoError:
        mongo.close()
        pytest.fail("MongoDB is required. Start MongoDB or set TEST_MONGODB_URI to a test server.")
    with instance.test_client() as client:
        assert client.get("/api/health").status_code == 200
    yield instance
    mongo.drop_database(instance.config["MONGODB_DATABASE"])
    mongo.close()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def db(app):
    return app.extensions["mongo_client"][app.config["MONGODB_DATABASE"]]


@pytest.fixture
def registration():
    return {
        "firstName": "Alex", "lastName": "User", "email": "alex@example.com",
        "password": "LibraryPass123", "confirmPassword": "LibraryPass123",
    }


@pytest.fixture
def accounts(client, db, registration):
    result = {}
    for name, role in [("alice", "user"), ("bob", "user"), ("admin", "admin")]:
        payload = {**registration, "email": f"{name}@example.com", "firstName": name.title()}
        response = client.post("/api/register", json=payload)
        assert response.status_code == 201
        db.users.update_one({"email": payload["email"]}, {"$set": {"role": role}})
        result[name] = {"Authorization": f"Bearer {response.json['token']}"}
    return result


@pytest.fixture
def hardware(client, accounts):
    response = client.post("/api/hardware", headers=accounts["admin"], json={
        "hardwareId": "HW-001", "name": "Hardware 1", "description": "Shared test resource.",
    })
    assert response.status_code == 201
    return response.json["hardware"]
