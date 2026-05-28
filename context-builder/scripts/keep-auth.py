#!/usr/bin/env python3
"""One-time gkeepapi auth via browser oauth_token cookie exchange.

Steps:
  1. Open https://accounts.google.com/EmbeddedSetup in a browser
     while logged into the Google account for Keep.
  2. Click "I agree" (page appears to hang - this is normal).
  3. DevTools → Application → Cookies → accounts.google.com
     → copy the value of the "oauth_token" cookie (starts with oauth2_4/...).
  4. Run this script and paste the cookie value when prompted.
"""
import gkeepapi
import gpsoauth
import os
import json

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

    email = os.environ.get("GKEEPAPI_EMAIL") or input("Google account email: ")
    oauth_token = input("Paste oauth_token cookie value from EmbeddedSetup: ").strip()

    print("Exchanging token...")
    res = gpsoauth.exchange_token(email, oauth_token, "aabbccddeeff00112233")
    if "Token" not in res:
        print(f"Token exchange failed: {res}")
        return 1

    master_token = res["Token"]

    print("Verifying with gkeepapi...")
    keep = gkeepapi.Keep()
    try:
        keep.authenticate(email, master_token)
    except gkeepapi.exception.LoginException as e:
        print(f"Authentication failed: {e}")
        return 1

    with open(TOKEN_PATH, "w") as f:
        json.dump({"email": email, "master_token": master_token}, f)
    print(f"Token saved to {TOKEN_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
