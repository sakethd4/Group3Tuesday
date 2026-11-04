"""Each hardware document represents one physical resource, never a quantity."""
from datetime import datetime, timezone

from pymongo import ReturnDocument


def createHardware(db, fields):
    hardware = {
        **fields,
        "status": "available",
        "checkedOutTo": None,
        "checkedOutBy": None,
        "checkedOutAt": None,
        "createdAt": datetime.now(timezone.utc),
    }
    db.hardware.insert_one(hardware)
    return hardware


def checkOut(db, hardware_id, project_id, user_id, session):
    # The predicate and update are one atomic MongoDB operation. Only one
    # contender can change an available resource to checked_out.
    return db.hardware.find_one_and_update(
        {"_id": hardware_id, "status": "available", "checkedOutTo": None},
        {"$set": {"status": "checked_out", "checkedOutTo": project_id, "checkedOutBy": user_id,
                  "checkedOutAt": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER, session=session,
    )


def checkIn(db, hardware_id, project_id, session):
    return db.hardware.find_one_and_update(
        {"_id": hardware_id, "status": "checked_out", "checkedOutTo": project_id},
        {"$set": {"status": "available", "checkedOutTo": None, "checkedOutBy": None, "checkedOutAt": None}},
        return_document=ReturnDocument.AFTER, session=session,
    )


def updateHardware(db, hardware_id, fields):
    # Metadata edits never change the current project assignment or availability.
    return db.hardware.find_one_and_update(
        {"_id": hardware_id}, {"$set": fields}, return_document=ReturnDocument.AFTER
    )


def removeHardware(db, hardware_id):
    # A concurrent checkout also prevents deletion.
    return db.hardware.delete_one(
        {"_id": hardware_id, "status": "available", "checkedOutTo": None}
    ).deleted_count


def seedHardware(db):
    for number in range(1, 7):
        db.hardware.update_one(
            {"hardwareId": f"HW-{number:03}"},
            {"$setOnInsert": {
                "name": f"Hardware {number}",
                "description": f"Shared hardware resource {number}.",
                "status": "available",
                "checkedOutTo": None,
                "checkedOutBy": None,
                "checkedOutAt": None,
                "createdAt": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
