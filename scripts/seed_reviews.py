#!/usr/bin/env python3
"""Seed demo users + reviews using the Supabase service-role key (admin).

Trusted LOCAL tooling only — never ship this or the service key to a client.
Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
Idempotent-ish: re-running upserts profiles/reviews and tolerates existing users.
"""
import os, json, urllib.request, urllib.error

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def req(method, path, body=None, extra=None):
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


USERS = [
    {"email": "alice@example.com", "handle": "alice", "name": "Alice", "role": "critic"},
    {"email": "bob@example.com",   "handle": "bob",   "name": "Bob",   "role": "user"},
    {"email": "carol@example.com", "handle": "carol", "name": "Carol", "role": "user"},
]

ids = {}
for u in USERS:
    st, resp = req("POST", "/auth/v1/admin/users",
                   {"email": u["email"], "password": "password123", "email_confirm": True})
    if st in (200, 201) and isinstance(resp, dict):
        ids[u["handle"]] = resp["id"]
    else:
        # already exists — look it up by email
        _, lst = req("GET", "/auth/v1/admin/users")
        people = lst.get("users", lst) if isinstance(lst, dict) else lst
        match = next((x["id"] for x in people if x.get("email") == u["email"]), None)
        ids[u["handle"]] = match
    if ids.get(u["handle"]):
        req("POST", "/rest/v1/profiles",
            {"id": ids[u["handle"]], "handle": u["handle"], "display_name": u["name"], "role": u["role"]},
            {"Prefer": "resolution=merge-duplicates"})
    print(f"user {u['handle']:6} -> {ids.get(u['handle'])}")

_, recs = req("GET", "/rest/v1/recordings?select=id,slug")
rid = {r["slug"]: r["id"] for r in recs}

REVIEWS = [
    ("beethoven-symphony-5-kleiber-vpo-1974", "alice", 5, "Electrifying — the definitive Fifth."),
    ("beethoven-symphony-5-kleiber-vpo-1974", "bob",   5, "Goosebumps from the first bar."),
    ("beethoven-symphony-5-kleiber-vpo-1974", "carol", 4, None),
    ("beethoven-symphony-5-karajan-bpo-1963", "alice", 4, "Polished, weighty, a little glossy."),
    ("beethoven-symphony-5-karajan-bpo-1963", "bob",   3, None),
    ("mozart-symphony-40-karajan-bpo-1970",   "alice", 4, None),
    ("mozart-symphony-40-karajan-bpo-1970",   "carol", 5, "Sublime urgency."),
]
for slug, handle, rating, body in REVIEWS:
    if rid.get(slug) and ids.get(handle):
        st, _ = req("POST", "/rest/v1/reviews",
                    {"recording_id": rid[slug], "author_id": ids[handle], "rating": rating, "body": body},
                    {"Prefer": "resolution=merge-duplicates"})
        print(f"review {handle:6} {rating}★ {slug[:36]:36} -> {st}")

print("done")
