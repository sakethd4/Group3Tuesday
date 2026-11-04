"""Copy the old single-database library without deleting or overwriting records.

Run with the old API stopped. Each imported hardware assignment and its history
commit together; rerunning the command skips already imported identities.
"""
from datetime import datetime, timezone

from bson import ObjectId

if __package__:
    from . import database, historyDatabase
else:
    import database
    import historyDatabase


def migrate(client, db, source_name):
    if source_name in db.names.values():
        raise ValueError("The legacy source database must differ from all destination databases.")
    source = client[source_name]
    users = hardware = 0
    for user in source.users.find({}):
        result = db.users.update_one({"_id": user["_id"]}, {"$setOnInsert": user}, upsert=True)
        users += int(result.upserted_id is not None)
    for old in source.hardware.find({}):
        def copy(session):
            if db.hardware.find_one({"_id": old["_id"]}, session=session):
                return False
            item = {**old, "checkedOutTo": None, "checkedOutAt": None}
            if old["status"] == "checked_out":
                borrower = db.users.find_one({"_id": old.get("checkedOutBy")}, session=session)
                if not borrower:
                    raise ValueError(f"Cannot migrate {old['hardwareId']}: its borrower account is missing.")
                label = f"MIGRATED-{borrower['_id']}".upper()
                project = db.projects.find_one({"projectId": label}, session=session)
                if project and (not project.get("legacyImport") or project["createdBy"] != borrower["_id"]):
                    raise ValueError(f"Reserved migration project ID {label} is already in use.")
                if not project:
                    project = {
                        "_id": ObjectId(), "projectId": label,
                        "name": f"{borrower['firstName']}'s existing checkouts",
                        "description": "Imported active checkouts. Return hardware here before assigning it to another project.",
                        "createdBy": borrower["_id"], "memberIds": [borrower["_id"]],
                        "hardwareCount": 0, "legacyImport": True, "createdAt": datetime.now(timezone.utc),
                    }
                    db.projects.insert_one(project, session=session)
                db.projects.update_one({"_id": project["_id"]}, {"$inc": {"hardwareCount": 1}}, session=session)
                item["checkedOutTo"] = project["_id"]
                historyDatabase.record(db, "migrated_checkout", item, project, borrower["_id"], session)
            db.hardware.insert_one(item, session=session)
            return True
        hardware += int(database.transaction(client, copy))
    return users, hardware
