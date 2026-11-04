"""Immutable event snapshots survive hardware edits and project/hardware deletion."""
from datetime import datetime, timezone

if __package__:
    from .projectsDatabase import reference
else:
    from projectsDatabase import reference


def record(db, action, hardware, project, user_id, session):
    db.history.insert_one({
        "action": action,
        "hardware": {"id": str(hardware["_id"]), "hardwareId": hardware["hardwareId"], "name": hardware["name"]},
        "project": reference(project), "actorId": user_id,
        "createdAt": datetime.now(timezone.utc),
    }, session=session)
