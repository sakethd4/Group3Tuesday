"""Separate databases on one MongoDB deployment, with cross-database transactions."""
from types import SimpleNamespace

from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern


def collections(client, config):
    names = {
        kind: config.get(f"MONGODB_{kind.upper()}_DATABASE") or f"{config['MONGODB_DATABASE']}_{kind}"
        for kind in ("users", "hardware", "projects", "history")
    }
    if len(set(names.values())) != len(names):
        raise RuntimeError("Users, hardware, projects, and history must use different MongoDB databases.")
    return SimpleNamespace(
        names=names,
        **{kind: client[name][kind] for kind, name in names.items()},
    )


def ensure_indexes(db):
    db.users.create_index("email", unique=True)
    db.hardware.create_index("hardwareId", unique=True)
    db.hardware.create_index("checkedOutTo")
    db.projects.create_index("projectId", unique=True)
    db.projects.create_index("memberIds")
    db.history.create_index([("createdAt", -1), ("_id", -1)])
    db.history.create_index([("project.id", 1), ("createdAt", -1), ("_id", -1)])
    db.history.create_index([("hardware.id", 1), ("createdAt", -1), ("_id", -1)])


def transaction(client, callback):
    with client.start_session() as session:
        return session.with_transaction(
            callback, read_concern=ReadConcern("snapshot"), write_concern=WriteConcern("majority")
        )
