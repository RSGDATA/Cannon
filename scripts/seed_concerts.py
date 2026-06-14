#!/usr/bin/env python3
"""Seed demo concert ratings for the past concert (VIENNA24) via the service-role key.
Trusted LOCAL tooling only. Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env.
"""
import os, json, urllib.request, urllib.error

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def req(method, path, body=None, extra=None):
    headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


_, concerts = req("GET", "/rest/v1/concerts?qr_code=eq.VIENNA24&select=id")
concert_id = concerts[0]["id"]
_, prog = req("GET", f"/rest/v1/concert_program?concert_id=eq.{concert_id}&select=work_id,works(slug)")
work_by_slug = {p["works"]["slug"]: p["work_id"] for p in prog}
_, people = req("GET", "/rest/v1/profiles?handle=in.(alice,bob,carol)&select=id,handle")
uid = {p["handle"]: p["id"] for p in people}

# (handle, overall, body, {work_slug: live_rating})
DATA = [
    ("alice", 5, "A night to remember — the Fifth raised the roof of the Musikverein.",
     {"beethoven-symphony-5": 5, "mozart-symphony-40": 4}),
    ("bob", 4, None, {"beethoven-symphony-5": 5, "mozart-symphony-40": 4}),
    ("carol", 4, "Gorgeous hall, glowing strings.", {"beethoven-symphony-5": 4, "mozart-symphony-40": 5}),
]

for handle, overall, body, lives in DATA:
    u = uid.get(handle)
    if not u:
        print("missing user", handle); continue
    req("POST", "/rest/v1/concert_checkins",
        {"concert_id": concert_id, "user_id": u, "before_start": True, "pre_done": True, "post_done": True},
        {"Prefer": "resolution=merge-duplicates"})
    req("POST", "/rest/v1/concert_reviews",
        {"concert_id": concert_id, "user_id": u, "rating": overall, "body": body},
        {"Prefer": "resolution=merge-duplicates"})
    for slug, live in lives.items():
        req("POST", "/rest/v1/concert_piece_ratings",
            {"concert_id": concert_id, "user_id": u, "work_id": work_by_slug[slug], "heard_before": True, "live_rating": live},
            {"Prefer": "resolution=merge-duplicates"})
    print(f"seeded {handle}: overall {overall}, lives {lives}")

print("done")
