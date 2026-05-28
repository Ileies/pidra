#!/usr/bin/env python3
"""Fetch all Google Keep notes via gkeepapi and output JSON to stdout."""
import gkeepapi
import os
import json
import sys

TOKEN_PATH = os.path.join(os.path.dirname(__file__), "../.keep-token.json")
ENV_PATH = os.path.join(os.path.dirname(__file__), "../../.env")


def load_env(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def main():
    load_env(ENV_PATH)

    email = os.environ.get("GKEEPAPI_EMAIL")
    master_token = os.environ.get("GKEEPAPI_MASTER_TOKEN")

    if not email or not master_token:
        if not os.path.exists(TOKEN_PATH):
            print(json.dumps({"error": "No token found. Run keep-auth.py first."}), file=sys.stderr)
            return 1
        with open(TOKEN_PATH) as f:
            creds = json.load(f)
        email = creds["email"]
        master_token = creds["master_token"]

    keep = gkeepapi.Keep()
    keep.authenticate(email, master_token)
    keep.sync()

    notes = []
    for note in keep.all():
        if hasattr(note, "text"):
            notes.append({
                "id": note.id,
                "title": note.title or "",
                "text": note.text if hasattr(note, "text") else "",
                "labels": [l.name for l in note.labels.all()],
                "isPinned": note.pinned,
                "isArchived": note.archived,
                "updatedAt": note.timestamps.updated.isoformat() if note.timestamps.updated else "",
            })

    print(json.dumps(notes, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
