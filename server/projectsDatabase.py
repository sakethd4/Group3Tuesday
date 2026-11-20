"""Projects own hardware; a user may belong to any number of projects."""
from datetime import datetime, timezone

from pymongo import ReturnDocument


def reference(project):
    return {"id": str(project["_id"]), "projectId": project["projectId"], "name": project["name"]}


def public_project(project, user_id, members):
    return {
        **reference(project), "description": project["description"],
        "creatorId": str(project["createdBy"]), "isCreator": project["createdBy"] == user_id,
        "isMember": user_id in project["memberIds"], "memberCount": len(project["memberIds"]),
        "hardwareCount": project["hardwareCount"],
        "owner": members.get(project["createdBy"]),
        "members": [members[member_id] for member_id in project["memberIds"] if member_id in members],
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
        {"projectId": project_id}, {"$addToSet": {"memberIds": user_id}},
        return_document=ReturnDocument.AFTER,
    )
