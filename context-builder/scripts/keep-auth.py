#!/usr/bin/env python3
"""One-time gkeepapi auth: fetches and stores a master token in .keep-token.json."""
import gkeepapi
import os
import getpass
import json

TOKEN_PATH = os.path.join(os.path.dirname(__file__), "../.keep-token.json")


def main():
    email = os.environ.get("GKEEPAPI_EMAIL") or input("Google account email: ")
    password = os.environ.get("GKEEPAPI_PASSWORD") or getpass.getpass(
        "App password (generate at myaccount.google.com/apppasswords): "
    )

    keep = gkeepapi.Keep()
    try:
        keep.login(email, password)
    except gkeepapi.exception.LoginException as e:
        print(f"Login failed: {e}")
        return 1

    token = keep.getMasterToken()
    with open(TOKEN_PATH, "w") as f:
        json.dump({"email": email, "master_token": token}, f)
    print(f"Token saved to {TOKEN_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
