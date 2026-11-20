"""Serve the Flask API and built React frontend from one Heroku application."""
from pathlib import Path

from flask import abort, send_from_directory

from server.app import app


CLIENT_DIST = Path(__file__).resolve().parent / "client" / "dist"


@app.get("/")
@app.get("/login")
@app.get("/register")
def frontend():
    return send_from_directory(CLIENT_DIST, "index.html")


@app.get("/<path:filename>")
def frontend_asset(filename):
    # Unknown API routes must remain errors, never HTML frontend responses.
    if filename == "api" or filename.startswith("api/"):
        abort(404)
    return send_from_directory(CLIENT_DIST, filename)
