#!/usr/bin/env python3
"""Fetch all Google Keep notes via gkeepapi and output JSON to stdout."""
import gkeepapi
import os
import json
import sys

TOKEN_PATH = os.path.join(os.path.dirname(__file__), "../.keep-token.json")

def main():
    if not os.path.exists(TOKEN_PATH):
        print(json.dumps({"error": "No token found. Run keep-auth.py first."}), file=sys.stderr)
        return 1

    with open(TOKEN_PATH) as f:
        creds = json.load(f)

    keep = gkeepapi.Keep()
    keep.resume(creds["email"], creds["master_token"])
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
