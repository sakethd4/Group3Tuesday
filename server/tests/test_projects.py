from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

from bson import ObjectId
import pytest
from pymongo.errors import OperationFailure

import historyDatabase
import usersDatabase


def test_projects_are_unique_and_users_can_join_multiple(client, accounts, projects, db):
    alice, bob = projects["alice"], projects["bob"]
    assert alice["isCreator"] and alice["isMember"] and alice["memberCount"] == 1
    duplicate = client.post("/api/projects", headers=accounts["bob"], json={
        "projectId": " proj-alice ", "name": "Duplicate",
    })
    assert duplicate.status_code == 409
    assert "project ID" in duplicate.json["message"]
    for _ in range(2):
        joined = client.post("/api/projects/join", json={"projectId": " proj-bob "}, headers=accounts["alice"])
        assert joined.status_code == 200
        assert joined.json["project"]["memberCount"] == 2
        assert joined.json["project"]["isMember"] and not joined.json["project"]["isCreator"]
    mine = client.get("/api/projects?mine=true", headers=accounts["alice"]).json["projects"]
    assert {p["id"] for p in mine} == {alice["id"], bob["id"]}
    assert db.projects.count_documents({}) == 2


@pytest.mark.parametrize("payload", [None, {}, {"userId": "user"}, {"projectId": {"$ne": None}},
                                     {"projectId": "invalid"}, {"projectId": "0" * 24}])
def test_checkout_cannot_target_a_user_or_invalid_project(client, accounts, hardware, payload, db):
    response = client.post(f"/api/hardware/{hardware['id']}/checkout", json=payload, headers=accounts["alice"])
    assert response.status_code in (400, 404)
    assert db.hardware.find_one({})["status"] == "available"
    assert db.history.count_documents({}) == 0


def test_checkout_requires_membership_and_members_share_inventory(client, accounts, projects, hardware, db):
    url = f"/api/hardware/{hardware['id']}"
    alice = projects["alice"]
    assert client.post(f"{url}/checkout", json={"projectId": alice["id"]}, headers=accounts["bob"]).status_code == 403
    assert client.post(f"{url}/checkout", json={"projectId": alice["id"], "userId": "someone"}, headers=accounts["alice"]).status_code == 400
    assert client.post(f"{url}/checkout", json={"projectId": alice["id"]}, headers=accounts["alice"]).status_code == 200
    assert client.get(f"/api/hardware?mine=true&project={alice['id']}", headers=accounts["bob"]).json["hardware"] == []
    client.post("/api/projects/join", json={"projectId": alice["projectId"]}, headers=accounts["bob"])
    for path in ("/api/hardware?mine=true", f"/api/hardware?project={alice['id']}"):
        resources = client.get(path, headers=accounts["bob"]).json["hardware"]
        assert len(resources) == 1
        assert resources[0]["canReturn"] and resources[0]["project"]["id"] == alice["id"]
    # Bob can return Alice's checkout because the project owns it.
    assert client.post(f"{url}/return", headers=accounts["bob"]).status_code == 200
    assert db.projects.find_one({"_id": ObjectId(alice["id"])})["hardwareCount"] == 0
    events = client.get("/api/history", headers=accounts["alice"]).json["history"]
    assert [e["action"] for e in events] == ["return", "checkout"]
    assert [e["isByMe"] for e in events] == [False, True]
    assert all("actor" not in e for e in events)
    admin_events = client.get("/api/history", headers=accounts["admin"]).json["history"]
    assert admin_events == []


def test_only_creator_can_delete_and_history_survives_deletion(client, accounts, projects, hardware, db):
    project_url = f"/api/projects/{projects['alice']['id']}"
    hardware_url = f"/api/hardware/{hardware['id']}"
    for user in ("bob", "admin"):
        assert client.delete(project_url, headers=accounts[user]).status_code == 403
    client.post(f"{hardware_url}/checkout", headers=accounts["alice"], json={"projectId": projects["alice"]["id"]})
    assert client.delete(project_url, headers=accounts["alice"]).status_code == 409
    client.put(hardware_url, headers=accounts["admin"], json={"hardwareId": "RENAMED", "name": "Renamed", "description": "Updated"})
    client.post(f"{hardware_url}/return", headers=accounts["alice"])
    assert client.delete(project_url, headers=accounts["alice"]).status_code == 204
    assert client.delete(hardware_url, headers=accounts["admin"]).status_code == 204
    assert client.post(f"{project_url}/join", headers=accounts["bob"]).status_code == 404
    events = client.get(f"/api/history?project={projects['alice']['id']}", headers=accounts["alice"]).json["history"]
    assert len(events) == 2
    assert events[1]["hardware"]["hardwareId"] == "HW-001"
    assert events[0]["hardware"]["hardwareId"] == "RENAMED"
    assert all(e["project"]["name"] == projects["alice"]["name"] for e in events)


def test_history_failure_rolls_back_assignment_and_project_count(client, accounts, projects, hardware, db, monkeypatch):
    def failed(*args):
        raise OperationFailure("Injected history write failure")
    monkeypatch.setattr(historyDatabase, "record", failed)
    response = client.post(f"/api/hardware/{hardware['id']}/checkout", headers=accounts["alice"], json={"projectId": projects["alice"]["id"]})
    assert response.status_code == 503
    assert db.hardware.find_one({})["status"] == "available"
    assert db.projects.find_one({"_id": ObjectId(projects["alice"]["id"])})["hardwareCount"] == 0
    assert db.history.count_documents({}) == 0


def test_checkout_racing_project_deletion_never_orphans_hardware(app, accounts, projects, hardware, db):
    barrier = Barrier(2)
    def checkout():
        with app.test_client() as client:
            barrier.wait()
            return client.post(f"/api/hardware/{hardware['id']}/checkout", headers=accounts["alice"], json={"projectId": projects["alice"]["id"]}).status_code
    def delete():
        with app.test_client() as client:
            barrier.wait()
            return client.delete(f"/api/projects/{projects['alice']['id']}", headers=accounts["alice"]).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(checkout), pool.submit(delete)
        statuses = first.result(), second.result()
    assert statuses in ((200, 409), (404, 204))
    resource = db.hardware.find_one({})
    if resource["status"] == "checked_out":
        assert db.projects.find_one({"_id": resource["checkedOutTo"]})["hardwareCount"] == 1
        assert db.history.count_documents({}) == 1
    else:
        assert db.history.count_documents({}) == 0


def test_concurrent_returns_create_one_event(app, client, accounts, projects, hardware, db):
    url = f"/api/hardware/{hardware['id']}"
    client.post(f"{url}/checkout", headers=accounts["alice"], json={"projectId": projects["alice"]["id"]})
    barrier = Barrier(4)
    def release(_):
        with app.test_client() as local:
            barrier.wait()
            return local.post(f"{url}/return", headers=accounts["alice"]).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(pool.map(release, range(4)))
    assert statuses.count(200) == 1 and statuses.count(409) == 3
    assert db.history.count_documents({"action": "return"}) == 1
    assert db.projects.find_one({"_id": ObjectId(projects["alice"]["id"])})["hardwareCount"] == 0


def test_separate_databases(app, db, accounts, projects, hardware):
    assert len(set(db.names.values())) == 4
    for kind, name in db.names.items():
        assert getattr(db, kind).database.name == name
        assert app.extensions["mongo_client"][name].list_collection_names() == [kind]


def test_history_pagination_and_filtering(client, accounts, projects, hardware, db):
    actor = db.users.find_one({"email": "alice@example.com"})["_id"]
    db.history.insert_many([{
        "action": "checkout", "actorId": actor, "createdAt": datetime.now(timezone.utc),
        "hardware": {key: hardware[key] for key in ("id", "hardwareId", "name")},
        "project": {key: projects["alice"][key] for key in ("id", "projectId", "name")},
    } for _ in range(53)])
    first = client.get("/api/history", headers=accounts["alice"]).json
    assert len(first["history"]) == 50 and first["nextCursor"]
    second = client.get(f"/api/history?before={first['nextCursor']}", headers=accounts["alice"]).json
    assert len(second["history"]) == 3 and second["nextCursor"] is None
    assert not {e["id"] for e in first["history"]} & {e["id"] for e in second["history"]}
    assert client.get(f"/api/history?project={projects['bob']['id']}", headers=accounts["bob"]).json["history"] == []
    assert client.get("/api/history?before=invalid", headers=accounts["alice"]).status_code == 404
    assert client.get("/api/history").status_code == 401


def test_migration_preserves_accounts_active_assignments_and_is_repeatable(app, client, db):
    legacy = app.extensions["mongo_client"][app.config["MONGODB_DATABASE"]]
    user = usersDatabase.addUser(legacy, "Legacy", "User", "legacy@example.com", "LibraryPass123")
    legacy.hardware.insert_one({"hardwareId": "OLD-001", "name": "Old hardware", "description": "Preserve me",
                                "status": "checked_out", "checkedOutBy": user["_id"]})
    runner = app.test_cli_runner()
    result = runner.invoke(args=["migrate-db"])
    assert result.exit_code == 0, result.output
    login = client.post("/api/login", json={"email": user["email"], "password": "LibraryPass123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json['token']}"}
    item = client.get("/api/hardware", headers=headers).json["hardware"][0]
    assert item["canReturn"] and item["project"]["projectId"].startswith("MIGRATED-")
    assert db.history.find_one({})["action"] == "migrated_checkout"
    assert client.post(f"/api/hardware/{item['id']}/return", headers=headers).status_code == 200
    assert runner.invoke(args=["migrate-db"]).exit_code == 0
    assert db.users.count_documents({}) == db.hardware.count_documents({}) == db.projects.count_documents({}) == 1
    assert db.history.count_documents({}) == 2
    assert db.hardware.find_one({})["status"] == "available"
    assert legacy.hardware.find_one({})["status"] == "checked_out"


def test_history_uses_event_time_across_api_instances(client, accounts, projects, hardware, db):
    actor = db.users.find_one({"email": "alice@example.com"})["_id"]
    now = datetime.now(timezone.utc)
    base = {"actorId": actor, "hardware": {key: hardware[key] for key in ("id", "hardwareId", "name")},
            "project": {key: projects["alice"][key] for key in ("id", "projectId", "name")}}
    # Different workers can generate IDs whose lexical order differs from event time.
    older = {**base, "_id": ObjectId("ffffffffffffffffffffffff"), "action": "checkout", "createdAt": now - timedelta(seconds=1)}
    newer = {**base, "_id": ObjectId("000000000000000000000001"), "action": "return", "createdAt": now}
    db.history.insert_many([older, newer])
    events = client.get("/api/history", headers=accounts["alice"]).json["history"]
    assert [event["action"] for event in events] == ["return", "checkout"]
    page = client.get(f"/api/history?before={newer['_id']}", headers=accounts["alice"]).json["history"]
    assert [event["action"] for event in page] == ["checkout"]


@pytest.mark.parametrize("payload", [
    {"projectId": "bad id", "name": "Project"}, {"projectId": "TEST", "name": " "},
    {"projectId": "TEST", "name": "Project", "createdBy": "someone else"},
])
def test_project_validation(client, accounts, payload):
    assert client.post("/api/projects", headers=accounts["alice"], json=payload).status_code == 400


def test_project_routes_require_authentication(client):
    assert client.get("/api/projects").status_code == 401
    assert client.post("/api/projects", json={"projectId": "TEST", "name": "Test"}).status_code == 401
    assert client.post("/api/projects/join", json={"projectId": "TEST"}).status_code == 401
    assert client.delete(f"/api/projects/{ObjectId()}").status_code == 401


@pytest.mark.parametrize('payload', [None, {}, {'projectId': ''}, {'projectId': {'$ne': ''}},
                                     {'projectId': 'PROJ-alice', 'userId': 'alice'}, {'projectId': 'bad id'}])
def test_join_requires_a_valid_project_code(client, accounts, projects, payload):
    assert client.post('/api/projects/join', json=payload, headers=accounts['bob']).status_code == 400
    assert len(client.get('/api/projects', headers=accounts['bob']).json['projects']) == 1


def test_project_privacy_and_owner_member_names(client, accounts, projects):
    alice = projects['alice']
    for suffix in ('', '?mine=false', '?mine=true'):
        visible = client.get(f'/api/projects{suffix}', headers=accounts['alice']).json['projects']
        assert [p['id'] for p in visible] == [alice['id']]
        assert visible[0]['owner']['firstName'] == 'Alice'
        assert visible[0]['members'] == [visible[0]['owner']]
        assert set(visible[0]['owner']) == {'id', 'firstName', 'lastName'}
    assert client.get('/api/projects', headers=accounts['admin']).json['projects'] == []
    # Neither knowing a MongoDB ID nor calling the old join route grants access.
    assert client.post('/api/projects/join', headers=accounts['bob'], json={'projectId': alice['id']}).status_code == 404
    assert client.post(f"/api/projects/{alice['id']}/join", headers=accounts['bob']).status_code == 404
    assert client.post('/api/projects/join', headers=accounts['bob'], json={'projectId': 'UNKNOWN'}).status_code == 404
    joined = client.post('/api/projects/join', headers=accounts['bob'], json={'projectId': alice['projectId']}).json['project']
    assert joined['owner']['firstName'] == 'Alice'
    assert [member['firstName'] for member in joined['members']] == ['Alice', 'Bob']


def test_hardware_and_history_cannot_reveal_other_projects(client, accounts, projects, hardware, db):
    project = projects['alice']
    url = f"/api/hardware/{hardware['id']}"
    assert client.post(f'{url}/checkout', json={'projectId': project['id']}, headers=accounts['alice']).status_code == 200
    event_id = str(db.history.find_one({})['_id'])
    for name in ('bob', 'admin'):
        headers = accounts[name]
        for suffix in ('', '?mine=false', '?mine=true', f"?project={project['id']}"):
            assert client.get(f'/api/hardware{suffix}', headers=headers).json['hardware'] == []
        assert client.get(url, headers=headers).status_code == 404
        for suffix in ('', f"?project={project['id']}", f"?hardware={hardware['id']}"):
            assert client.get(f'/api/history{suffix}', headers=headers).json['history'] == []
        assert client.get(f'/api/history?before={event_id}', headers=headers).status_code == 404
    assert client.post('/api/projects/join', json={'projectId': project['projectId']}, headers=accounts['bob']).status_code == 200
    assert client.get(url, headers=accounts['bob']).json['hardware']['canReturn']
    assert len(client.get('/api/history', headers=accounts['bob']).json['history']) == 1
    assert client.post(f'{url}/return', headers=accounts['bob']).status_code == 200
    assert len(client.get('/api/hardware', headers=accounts['admin']).json['hardware']) == 1
    assert client.delete(f"/api/projects/{project['id']}", headers=accounts['alice']).status_code == 204
    for name in ('alice', 'bob'):
        assert len(client.get('/api/history', headers=accounts[name]).json['history']) == 2
    assert client.get('/api/history', headers=accounts['admin']).json['history'] == []
