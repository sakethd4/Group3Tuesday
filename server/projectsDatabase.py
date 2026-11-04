"""Projects own hardware; a user may belong to any number of projects."""
from datetime import datetime, timezone

from pymongo import ReturnDocument


def reference(project):
    return {"id": str(project["_id"]), "projectId": project["projectId"], "name": project["name"]}


def public_project(project, user_id):
    return {
        **reference(project), "description": project["description"],
        "creatorId": str(project["createdBy"]), "isCreator": project["createdBy"] == user_id,
        "isMember": user_id in project["memberIds"], "memberCount": len(project["memberIds"]),
        "hardwareCount": project["hardwareCount"],
    }


def createProject(db, fields, user_id):
    project = {
        **fields, "createdBy": user_id, "memberIds": [user_id], "hardwareCount": 0,
        "createdAt": datetime.now(timezone.utc),
    }
    db.projects.insert_one(project)
    return project


def joinProject(db, project_id, user_id):
    return db.projects.find_one_and_update(
        {"_id": project_id}, {"$addToSet": {"memberIds": user_id}},
        return_document=ReturnDocument.AFTER,
    )
