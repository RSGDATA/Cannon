# Cannon — Vision & Architecture

> **Read this first.** Authoritative source of truth for what Cannon is and how
> it's built. If you are an AI agent or new contributor picking this up cold,
> read this whole file before touching anything. Companion docs:
> [`data-model.md`](./data-model.md) (Firestore schema) and
> [`deploy-setup.md`](./deploy-setup.md) (CI/CD, for *later*).

---

## 1. The product

**Cannon is "Rotten Tomatoes for classical music."**

> You do **not** rate "Beethoven Symphony No. 5."
> You rate **a specific recording / performance** of it
> (e.g. *Carlos Kleiber / Vienna Philharmonic / 1974*).

- **Mobile-first.** The Flutter app is the primary client; the web app is secondary.
- Users browse composers/works, rate & review individual **recordings**, build
  **lists**, and discuss in **comments**. Scores come in two flavors:
  **critic** (verified) and **audience** (everyone).

---

## 2. Core architectural principle: Work ≠ Recording

```
Composer ──▶ Work ──▶ Recording ◀── Review ◀── User
Beethoven   Sym. 5   Kleiber/VPO/74   ★★★★★
```

A `Work` is the abstract composition; a `Recording` is one captured performance.
**Ratings/reviews attach to `Recording`, never to `Work`.** See `data-model.md`.

---

## 3. Guiding constraint: ZERO COST right now

> **The owner does not want to incur or manage any cost during the prototype.**
> Every choice below flows from that. Do not introduce anything that requires a
> paid plan or a billing account without explicit owner approval.

### 3a. Tech stack (matches the owner's original brief, phased by cost)

| Layer | Choice | Phase |
|-------|--------|-------|
| Mobile app (primary) | **Flutter** | now |
| Web app (secondary) | **React** (Vite), static via Firebase Hosting | now |
| Database | **Cloud Firestore** | now (**emulator**) |
| Auth | **Firebase Auth** | now (**emulator**) |
| Hosting | **Firebase Hosting** | now (**emulator**) |
| Cloud Functions (TypeScript) | server-side logic / aggregation | **LATER** — needs paid Blaze plan |
| Firebase Storage (images/audio) | — | **LATER** — needs paid Blaze plan |
| Search (Algolia / Meilisearch) | — | **LATER** |

This is the owner's original stack. Nothing is removed — the paid pieces
(**Cloud Functions, Storage**) are simply **deferred** until the owner chooses
to incur cost. They are *the* things that cost money, so deferring them is how
Cannon stays at $0.

### 3b. Current phase: develop locally on the Firebase Emulator Suite

The prototype runs **entirely on the local machine** via the Firebase Emulator
Suite — Firestore + Auth + Hosting on `localhost`. **No cloud project use, no
billing account, no credit card, no cost, nothing to monitor.** The same
Firebase SDK code later points at a real project when (if) the owner decides to
deploy. Emulator ports are defined in `firebase.json`.

> Even a deployed Firebase project on the free **Spark** plan is $0 (no card).
> Only **Blaze** (Functions/Storage) costs money. We deploy nothing for now.

### 3c. How ratings aggregate WITHOUT Cloud Functions (for the prototype)

Because Functions are deferred (cost), the prototype aggregates serverlessly:

1. **Clients write only their own review.** Doc ID `{recordingId}_{uid}` prevents
   duplicates; security rules block clients from writing any aggregate field.
2. **Display scores** (a recording's average + count) are computed live with
   **Firestore aggregation queries** (`count()`, `average()`) over the real
   review docs — can't be faked, works in the emulator.
3. **Ranking scores** (sortable Bayesian score) are written by an **optional
   local Admin-SDK script** the owner runs — a script on a trusted machine, not
   a deployed Function.

When the owner later adopts Cloud Functions (their original plan), aggregation
can move server-side. See `data-model.md` §6.

**Out of scope for the prototype:** push notifications, automated moderation
(both need a server). Moderation = user reports + manual admin action for now.

---

## 4. Current infrastructure state (as of 2026-06)

| Thing | Value / status |
|-------|----------------|
| **Dev target** | **Firebase Emulator Suite (local) — $0, no cloud** |
| Firebase project (exists, **unused for now**) | `cannon-music-prod` — created earlier; not provisioned, not deployed to |
| Billing | **none — Spark/free, no card; Blaze never enabled** |
| GitHub repo | `RSGDATA/Cannon` (public) |
| Cloud deploy pipeline | **set up but disabled (manual-only)** — `deploy-prod.yml` no longer auto-runs; re-enable when ready to deploy |
| `web/` (React) | not scaffolded yet |
| `mobile/` (Flutter) | not scaffolded yet |

---

## 5. Roadmap / phases

- **Phase 0 — Foundation (in progress):** repo, data model, this doc, local
  emulator config. **No cloud.**
- **Phase 1 — Prototype on emulators ($0):** scaffold React + Flutter against the
  emulator suite; seed catalog data locally; browse composers/works/recordings;
  Auth login. Reviews with deterministic IDs; display scores via aggregation
  queries.
- **Phase 2 — Go online (owner's call):** deploy to the free Spark project
  (still $0) when the owner wants a shareable URL.
- **Phase 3 — Paid features (owner's call, costs money):** enable Blaze → Cloud
  Functions for server-side aggregation (original plan), Firebase Storage for
  images. Then Algolia search.

---

## 6. Guardrails for the next agent

- **Do not introduce anything that costs money** or requires the Blaze plan
  (Cloud Functions deploy, Storage) without explicit owner approval. Zero-cost is
  the active constraint (§3).
- **Default to the local emulator suite**, not a live cloud project.
- Cloud Functions are **deferred, not deleted** — they're in the owner's original
  stack for later. For the prototype, prefer aggregation queries / a local script.
- **Keep `Work` and `Recording` separate.** Ratings live on recordings.
- **Clients never write aggregate/score fields** — enforce in security rules.

---

## 7. Open decisions (not yet locked)

See `data-model.md` §9. Notably: rating scale (5 stars vs 1–10), critic
verification, per-movement ratings, following/activity feed, multi-composer works.
